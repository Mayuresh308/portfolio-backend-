import { startAnswer } from "../src/answer.js";
import { LIMITS, MESSAGES } from "../src/config.js";
import { checkCors, preflight } from "../src/cors.js";
import { clientIp, describeError, errorResponse, log, logWarn, readBodyCapped } from "../src/http.js";
import { buildSystemPrompt } from "../src/prompt.js";
import { checkRateLimit } from "../src/ratelimit.js";
import { validateChatBody } from "../src/validate.js";

export function OPTIONS(request: Request): Response {
  return preflight(request);
}

export async function POST(request: Request): Promise<Response> {
  try {
    return await handleChat(request);
  } catch (err) {
    logWarn("chat_unhandled_error", describeError(err));
    const cors = checkCors(request);
    return errorResponse(MESSAGES.unavailable, 500, cors.ok ? cors.headers : {});
  }
}

async function handleChat(request: Request): Promise<Response> {
  const started = Date.now();

  const cors = checkCors(request);
  if (!cors.ok) return errorResponse("Origin not allowed.", 403);
  const headers = cors.headers;

  const limit = await checkRateLimit(clientIp(request));
  if (!limit.allowed) {
    log("chat_ip_limited");
    return errorResponse(MESSAGES.ipLimited, 429, { ...headers, "Retry-After": String(limit.retryAfterSeconds) });
  }

  const raw = await readBodyCapped(request, LIMITS.maxBodyBytes);
  if (raw === null) return errorResponse("Request body too large.", 413, headers);

  const result = validateChatBody(raw);
  if (!result.ok) return errorResponse(result.error, 400, headers);
  const { messages } = result;

  let systemPrompt: string;
  try {
    systemPrompt = buildSystemPrompt();
  } catch (err) {
    logWarn("knowledge_load_error", describeError(err));
    return errorResponse(MESSAGES.unavailable, 503, headers);
  }

  const answer = await startAnswer({ systemPrompt, messages, signal: request.signal });

  if ("kind" in answer) {
    log("chat_failed", { kind: answer.kind, ms: Date.now() - started });
    return answer.kind === "rate_limited"
      ? errorResponse(MESSAGES.providerBusy, 429, { ...headers, "Retry-After": "60" })
      : errorResponse(MESSAGES.unavailable, 503, headers);
  }

  const { provider, model, first, rest } = answer;
  const encoder = new TextEncoder();
  let chars = 0;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const text = first || MESSAGES.emptyAnswer;
      chars += text.length;
      controller.enqueue(encoder.encode(text));
    },
    async pull(controller) {
      try {
        const { done, value } = await rest.next();
        if (done) {
          controller.close();
          log("chat_ok", { provider, model, turns: messages.length, outChars: chars, ms: Date.now() - started });
          return;
        }
        chars += value.length;
        controller.enqueue(encoder.encode(value));
      } catch (err) {
        logWarn("chat_stream_error", { provider, model, ...describeError(err) });
        controller.enqueue(encoder.encode("\n\n[The answer was interrupted — please try again.]"));
        controller.close();
      }
    },
    async cancel() {
      await rest.return(undefined).catch(() => {});
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      ...headers,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
