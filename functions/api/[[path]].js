const DEFAULT_API_ORIGIN = "https://smart-campus-web-six.vercel.app";

function targetUrl(request, params, env) {
  const source = new URL(request.url);
  const route = Array.isArray(params.path) ? params.path.join("/") : String(params.path || "");
  const origin = String(env.API_ORIGIN || DEFAULT_API_ORIGIN).replace(/\/+$/, "");
  const target = new URL(`${origin}/api/${route}`);
  target.search = source.search;
  return target;
}
export async function onRequest(context) {
  const { request, params, env } = context;
  const route = Array.isArray(params.path) ? params.path.join("/") : String(params.path || "");
  const target = targetUrl(request, params, env);
  const headers = new Headers(request.headers);
  const requestId = /^[A-Za-z0-9._-]{8,100}$/.test(headers.get("x-request-id") || "")
    ? headers.get("x-request-id")
    : crypto.randomUUID();

  headers.delete("host");
  headers.delete("content-length");
  headers.set("x-forwarded-host", new URL(request.url).host);
  headers.set("x-forwarded-proto", "https");
  headers.set("x-request-id", requestId);

  if (env.VERCEL_PROTECTION_BYPASS) {
    headers.set("x-vercel-protection-bypass", env.VERCEL_PROTECTION_BYPASS);
  }

  try {
    const timeoutMs = Math.min(Math.max(Number(env.API_PROXY_TIMEOUT_MS || 20000), 1000), 30000);
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs)
    });
    const responseHeaders = new Headers(upstream.headers);
    const authenticated = headers.has("authorization");
    const browserCacheSeconds = request.method === "GET" && !authenticated ? {
      exams: 1800,
      labs: 300,
      "lab-rules": 1800,
      "library/layout": 300,
      "canteen/menu": 120,
      "tools/catalog": 3600,
      "campus-news": 60
    }[route] : 0;
    responseHeaders.set(
      "cache-control",
      browserCacheSeconds
        ? `private, max-age=${browserCacheSeconds}, stale-while-revalidate=60`
        : "no-store"
    );
    responseHeaders.set("x-campus-api-origin", "vercel");
    responseHeaders.set("x-content-type-options", "nosniff");
    responseHeaders.set("x-request-id", requestId);
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders
    });
  } catch (error) {
    return Response.json({
      error: "校园服务暂时无法连接，请稍后重试"
    }, {
      status: 502,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-request-id": requestId
      }
    });
  }
}
