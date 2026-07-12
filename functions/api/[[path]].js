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
  const target = targetUrl(request, params, env);
  const headers = new Headers(request.headers);

  headers.delete("host");
  headers.delete("content-length");
  headers.set("x-forwarded-host", new URL(request.url).host);
  headers.set("x-forwarded-proto", "https");

  if (env.VERCEL_PROTECTION_BYPASS) {
    headers.set("x-vercel-protection-bypass", env.VERCEL_PROTECTION_BYPASS);
  }

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "manual"
    });
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set("cache-control", "no-store");
    responseHeaders.set("x-campus-api-origin", "vercel");
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders
    });
  } catch (error) {
    return Response.json({
      error: "校园服务暂时无法连接，请稍后重试",
      detail: error instanceof Error ? error.message : "upstream unavailable"
    }, { status: 502 });
  }
}
