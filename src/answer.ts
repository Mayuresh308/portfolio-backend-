import { LIMITS, config } from "./config.js";
import { describeError, log, logWarn } from "./http.js";
import { streamGemini } from "./providers/gemini.js";
import { groqConfigured, streamGroq } from "./providers/groq.js";
import { ProviderError, type StreamFn, type StreamParams } from "./providers/types.js";

export type Answer = {
  provider: "gemini" | "groq";
  model: string;
  /** First non-empty chunk ("" if the provider returned no text at all). */
  first: string;
  rest: AsyncGenerator<string>;
};

export type AnswerFailure = { kind: "rate_limited" | "unavailable" };

/**
 * Start the stream and wait for the first text chunk before committing to a response,
 * so provider errors can still become a clean status code or trigger the Groq fallback.
 */
async function prime(fn: StreamFn, params: StreamParams): Promise<{ first: string; rest: AsyncGenerator<string> }> {
  const gen = fn(params);
  for (;;) {
    const { done, value } = await gen.next();
    if (done) return { first: "", rest: gen };
    if (value) return { first: value, rest: gen };
  }
}

function statusOf(err: unknown): number | undefined {
  return err instanceof ProviderError ? err.status : undefined;
}

/** Rate limits, 5xx, and network failures (no HTTP status) are worth retrying on Groq. */
function isFallbackWorthy(err: unknown): boolean {
  if (err instanceof Error && err.name === "AbortError") return false;
  const status = statusOf(err);
  return status === undefined || status === 429 || status >= 500;
}

export async function startAnswer(
  params: Omit<StreamParams, "maxOutputTokens">,
): Promise<Answer | AnswerFailure> {
  const full: StreamParams = { ...params, maxOutputTokens: LIMITS.maxOutputTokens };

  let lastErr: unknown;
  let sawRateLimit = false;
  try {
    const primed = await prime(streamGemini, full);
    return { provider: "gemini", model: config.geminiModel, ...primed };
  } catch (err) {
    lastErr = err;
    sawRateLimit ||= statusOf(err) === 429;
    logWarn("provider_error", { provider: "gemini", model: config.geminiModel, ...describeError(err) });
  }

  if (isFallbackWorthy(lastErr) && groqConfigured()) {
    try {
      const primed = await prime(streamGroq, full);
      log("provider_fallback", { provider: "groq", model: config.groqModel });
      return { provider: "groq", model: config.groqModel!, ...primed };
    } catch (err) {
      sawRateLimit ||= statusOf(err) === 429;
      logWarn("provider_error", { provider: "groq", model: config.groqModel, ...describeError(err) });
    }
  }

  return { kind: sawRateLimit ? "rate_limited" : "unavailable" };
}
