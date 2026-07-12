const crypto = require("crypto");

const TIMEOUT_MS = 8000;

function configured() {
  return {
    resend: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL),
    stripe: Boolean(process.env.STRIPE_SECRET_KEY),
    posthog: Boolean(process.env.POSTHOG_PROJECT_KEY),
    sentry: Boolean(process.env.SENTRY_DSN)
  };
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.timeout || TIMEOUT_MS));
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function safeText(value, limit = 2000) {
  return String(value || "")
    .replace(/\b1\d{10}\b/g, "[phone]")
    .replace(/\b\d{8,18}\b/g, "[identifier]")
    .replace(/\b(?:sk|re|phc|whsec)_[A-Za-z0-9_-]+\b/g, "[secret]")
    .slice(0, limit);
}

function anonymousId(user) {
  const source = String(user?.id || user?.studentNo || "anonymous");
  const salt = process.env.ANALYTICS_SALT || process.env.AUTH_SECRET || "smart-campus-analytics";
  return crypto.createHmac("sha256", salt).update(source).digest("hex").slice(0, 32);
}

async function sendEmail({ to, subject, text, html, idempotencyKey } = {}) {
  if (!configured().resend) return { configured: false, sent: false };
  const recipients = (Array.isArray(to) ? to : [to]).map(String).filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item));
  if (!recipients.length) return { configured: true, sent: false, reason: "missing_recipient" };
  const response = await fetchWithTimeout("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": String(idempotencyKey).slice(0, 256) } : {})
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL,
      to: recipients,
      subject: safeText(subject, 200),
      text: safeText(text, 10000),
      ...(html ? { html: String(html).slice(0, 30000) } : {})
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Resend request failed (${response.status})`);
  return { configured: true, sent: true, id: payload.id || "" };
}

async function captureAnalytics(event, user, properties = {}) {
  if (!configured().posthog) return false;
  const host = String(process.env.POSTHOG_HOST || "https://us.i.posthog.com").replace(/\/+$/, "");
  const cleanProperties = {};
  for (const [key, value] of Object.entries(properties || {})) {
    if (/name|phone|student|email|content|message|token|key/i.test(key)) continue;
    cleanProperties[key] = typeof value === "string" ? safeText(value, 200) : value;
  }
  try {
    const response = await fetchWithTimeout(`${host}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.POSTHOG_PROJECT_KEY,
        event: safeText(event, 120),
        properties: {
          distinct_id: anonymousId(user),
          role: user?.role || "anonymous",
          environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
          ...cleanProperties
        }
      })
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function createStripeCheckout({ orderId, user, scene, amount, successUrl, cancelUrl } = {}) {
  if (!configured().stripe) return { configured: false };
  const cents = Math.round(Number(amount) * 100);
  if (!Number.isInteger(cents) || cents < 50 || cents > 5000000) throw new Error("Invalid checkout amount");
  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("client_reference_id", String(orderId));
  params.set("success_url", successUrl);
  params.set("cancel_url", cancelUrl);
  params.set("line_items[0][price_data][currency]", "cny");
  params.set("line_items[0][price_data][unit_amount]", String(cents));
  params.set("line_items[0][price_data][product_data][name]", safeText(scene || "智慧校园服务", 120));
  params.set("line_items[0][quantity]", "1");
  params.set("metadata[order_id]", String(orderId));
  params.set("metadata[user_ref]", anonymousId(user));
  const response = await fetchWithTimeout("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": "2026-02-25.clover"
    },
    body: params
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Stripe checkout failed (${response.status})`);
  return { configured: true, id: payload.id || "", url: payload.url || "", status: payload.status || "open" };
}

function verifyStripeWebhook(rawBody, signatureHeader) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("Stripe webhook is not configured");
  const parts = Object.fromEntries(String(signatureHeader || "").split(",").map((item) => item.split("=", 2)));
  const timestamp = Number(parts.t || 0);
  const signature = String(parts.v1 || "");
  if (!timestamp || !signature || Math.abs(Date.now() / 1000 - timestamp) > 300) throw new Error("Invalid Stripe signature timestamp");
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const valid = expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  if (!valid) throw new Error("Invalid Stripe signature");
  return JSON.parse(rawBody);
}

function sentryEndpoint(dsn) {
  const value = new URL(dsn);
  const projectId = value.pathname.split("/").filter(Boolean).pop();
  const prefix = value.pathname.slice(0, value.pathname.lastIndexOf(`/${projectId}`));
  return {
    dsn,
    url: `${value.protocol}//${value.host}${prefix}/api/${projectId}/envelope/?sentry_key=${value.username}&sentry_version=7`
  };
}

async function captureError(error, context = {}) {
  if (!configured().sentry) return false;
  try {
    const endpoint = sentryEndpoint(process.env.SENTRY_DSN);
    const eventId = crypto.randomBytes(16).toString("hex");
    const event = {
      event_id: eventId,
      timestamp: Date.now() / 1000,
      platform: "node",
      level: "error",
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
      release: process.env.VERCEL_GIT_COMMIT_SHA || process.env.APP_RELEASE || "local",
      exception: { values: [{ type: safeText(error?.name || "Error", 120), value: safeText(error?.message || error, 1000) }] },
      tags: {
        route: safeText(context.route || "unknown", 200),
        method: safeText(context.method || "", 20),
        status: String(context.status || 500)
      },
      user: context.user ? { id: anonymousId(context.user) } : undefined
    };
    const envelope = `${JSON.stringify({ event_id: eventId, dsn: endpoint.dsn, sent_at: new Date().toISOString() })}\n${JSON.stringify({ type: "event", content_type: "application/json" })}\n${JSON.stringify(event)}`;
    const response = await fetchWithTimeout(endpoint.url, {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope" },
      body: envelope
    });
    return response.ok;
  } catch {
    return false;
  }
}

module.exports = {
  configured,
  sendEmail,
  captureAnalytics,
  createStripeCheckout,
  verifyStripeWebhook,
  captureError
};
