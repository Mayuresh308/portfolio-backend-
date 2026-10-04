import { waitUntil } from "@vercel/functions";
import { startAnswer } from "../src/answer.js";
import { logChat } from "../src/chatlog.js";
import { LIMITS, MESSAGES, NA_FALLBACK, config } from "../src/config.js";
import { loadLocalEnv } from "../src/env.js";
import { createMarkerFilter, readPastMarker } from "../src/marker.js";
import { checkCors, preflight } from "../src/cors.js";
import { clientIp, describeError, errorResponse, log, logWarn, readBodyCapped } from "../src/http.js";
import { buildSystemPrompt } from "../src/prompt.js";
import { checkRateLimit } from "../src/ratelimit.js";
import { validateChatBody } from "../src/validate.js";

// Local dev only: show what config the function actually sees (never keys).
if (config.isLocalDev) {
  log("dev_startup", {
    envFile: loadLocalEnv() ?? "(none; using env injected by vercel dev)",
    allowedOrigins: config.allowedOrigins,
    model: config.geminiModel,
    geminiKeySet: Boolean(config.geminiApiKey),
    groqFallback: Boolean(config.groqApiKey && config.groqModel),
    mongodb: Boolean(config.mongodbUri),
    rateLimitSalt: Boolean(config.rateLimitSalt),
  });
}

const INTERRUPTED_NOTE = "\n\n[The answer was interrupted — please try again.]";

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
  const { messages, conversationId } = result;
  // Position of this reply in the client's conversation (lets feedback be joined to the log).
  const messageIndex = result.messageIndex ?? messages.length;

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

  // Read ahead until the "[[NA]]" marker is confirmed or ruled out, so it can be stripped and reported
  // in X-Answered before any text is sent.
  const check = await readPastMarker(first, rest);
  if (check.error) logWarn("chat_stream_error", { provider, model, ...describeError(check.error) });
  const filter = createMarkerFilter();
  const encoder = new TextEncoder();
  const modelProduced = first.length > 0;
  let visible = "";
  let finished = false;

  const emit = (controller: ReadableStreamDefaultController<Uint8Array>, text: string) => {
    if (!text) return;
    visible += text;
    controller.enqueue(encoder.encode(text));
  };

  const finish = (controller: ReadableStreamDefaultController<Uint8Array>, interrupted: boolean) => {
    if (finished) return;
    finished = true;
    emit(controller, filter.flush());
    if (!visible.trim()) emit(controller, check.answered ? MESSAGES.emptyAnswer : NA_FALLBACK);
    if (interrupted) controller.enqueue(encoder.encode(INTERRUPTED_NOTE));
    controller.close();

    const answered = check.answered && !filter.seenLater;
    log("chat_ok", { provider, model, turns: messages.length, outChars: visible.length, answered, ms: Date.now() - started });
    // Only real, fully streamed answers are logged; after the response, never blocking it.
    if (modelProduced && !interrupted) {
      waitUntil(
        logChat({
          conversationId,
          messageIndex,
          question: messages[messages.length - 1].content,
          answer: visible,
          answered,
          model,
        }),
      );
    }
  };

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      emit(controller, filter.push(check.head));
      if (check.ended) finish(controller, Boolean(check.error));
    },
    async pull(controller) {
      if (finished) return;
      try {
        const { done, value } = await rest.next();
        if (done) finish(controller, false);
        else emit(controller, filter.push(value));
      } catch (err) {
        logWarn("chat_stream_error", { provider, model, ...describeError(err) });
        finish(controller, true);
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
      "X-Answered": String(check.answered),
    },
  });
}
