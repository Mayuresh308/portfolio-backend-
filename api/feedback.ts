import { waitUntil } from "@vercel/functions";
import { saveFeedback } from "../src/chatlog.js";
import { LIMITS, MESSAGES } from "../src/config.js";
import { checkCors, preflight } from "../src/cors.js";
import { clientIp, describeError, errorResponse, logWarn, readBodyCapped } from "../src/http.js";
import { checkRateLimit } from "../src/ratelimit.js";
import { validateFeedbackBody } from "../src/validate.js";

export function OPTIONS(request: Request): Response {
  return preflight(request);
}

/** POST { conversationId, messageIndex, rating: "up" | "down" } → 204. */
export async function POST(request: Request): Promise<Response> {
  try {
    const cors = checkCors(request);
    if (!cors.ok) return errorResponse("Origin not allowed.", 403);
    const headers = cors.headers;

    const limit = await checkRateLimit(clientIp(request));
    if (!limit.allowed) {
      return errorResponse(MESSAGES.ipLimited, 429, { ...headers, "Retry-After": String(limit.retryAfterSeconds) });
    }

    const raw = await readBodyCapped(request, LIMITS.maxFeedbackBytes);
    if (raw === null) return errorResponse("Request body too large.", 413, headers);

    const result = validateFeedbackBody(raw);
    if (!result.ok) return errorResponse(result.error, 400, headers);

    // Stored after the response; skipped silently without MongoDB.
    const { conversationId, messageIndex, rating } = result;
    waitUntil(saveFeedback({ conversationId, messageIndex, rating }));
    return new Response(null, { status: 204, headers });
  } catch (err) {
    logWarn("feedback_unhandled_error", describeError(err));
    const cors = checkCors(request);
    return errorResponse(MESSAGES.unavailable, 500, cors.ok ? cors.headers : {});
  }
}
