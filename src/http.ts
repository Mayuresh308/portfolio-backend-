// Small Response helpers and server-side logging that never includes secrets or message text.

export function json(body: unknown, status: number, headers: HeadersInit = {}): Response {
  const h = new Headers(headers);
  h.set("Content-Type", "application/json; charset=utf-8");
  h.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status, headers: h });
}

export function errorResponse(message: string, status: number, headers: HeadersInit = {}): Response {
  return json({ error: message }, status, headers);
}

export function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, ...fields }));
}

export function logWarn(event: string, fields: Record<string, unknown> = {}): void {
  console.warn(JSON.stringify({ event, level: "warn", ...fields }));
}

/** Describe an error for logs: status + a short, truncated message. */
export function describeError(err: unknown): { status?: number; name?: string; message?: string } {
  if (err && typeof err === "object") {
    const e = err as { status?: unknown; name?: unknown; message?: unknown };
    return {
      status: typeof e.status === "number" ? e.status : undefined,
      name: typeof e.name === "string" ? e.name : undefined,
      message: typeof e.message === "string" ? redact(e.message).slice(0, 200) : undefined,
    };
  }
  return { message: String(err).slice(0, 200) };
}

function redact(text: string): string {
  // Strip anything that looks like an API key or bearer token.
  return text
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted]")
    .replace(/gsk_[0-9A-Za-z]{20,}/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}

/** Read the request body as text, refusing anything larger than `maxBytes`. Returns null if too large. */
export async function readBodyCapped(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  const first = xff?.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip")?.trim() || "unknown";
}
