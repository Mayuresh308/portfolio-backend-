import { config, normalizeOrigin } from "./config.js";

export type CorsResult =
  | { ok: true; headers: Record<string, string> }
  | { ok: false };

/**
 * Only origins listed in ALLOWED_ORIGINS get through. Requests without an Origin header
 * (curl, scripts) are allowed only in local development so `pnpm eval` and curl work there.
 */
export function checkCors(request: Request): CorsResult {
  const origin = request.headers.get("origin");

  if (!origin) {
    return config.isLocalDev ? { ok: true, headers: { Vary: "Origin" } } : { ok: false };
  }

  if (!config.allowedOrigins.includes(normalizeOrigin(origin))) {
    return { ok: false };
  }

  return {
    ok: true,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      // Lets the widget read whether the question was answered (it then offers an email button).
      "Access-Control-Expose-Headers": "X-Answered",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    },
  };
}

export function preflight(request: Request): Response {
  const cors = checkCors(request);
  if (!cors.ok) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: cors.headers });
}
