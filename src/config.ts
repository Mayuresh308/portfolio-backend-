// Central place for env-driven settings and fixed limits.
import { isLocalDevEnv, loadLocalEnv } from "./env.js";

loadLocalEnv();

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

export const CONTACT_EMAIL = "mayureshmayuresh56@gmail.com";

export const LIMITS = {
  maxBodyBytes: 10 * 1024,
  maxMessages: 12,
  maxMessageChars: 600,
  maxTotalChars: 4000,
  maxOutputTokens: 400,
  maxFeedbackBytes: 1024,
  /** Highest message position the client may reference (its stored history is capped well below this). */
  maxMessageIndex: 199,
} as const;

/**
 * When nothing relevant is in the library, the model starts its reply with this marker. The server strips
 * it before streaming, logs the question as unanswered, and sends X-Answered: false so the widget can offer
 * an email button. Visitors never see it.
 */
export const NA_MARKER = "[[NA]]";

/** Used if the model sends the marker and nothing else. */
export const NA_FALLBACK = "Good question. Mayuresh hasn't shared that here yet, but he'd be happy to answer it directly.";

/** Client-generated conversation id: short, URL-safe, random. */
export const CONVERSATION_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export const MESSAGES = {
  providerBusy: `Lots of questions right now — please try again in a minute or email ${CONTACT_EMAIL}.`,
  ipLimited: `You've sent a lot of questions — please try again later or email ${CONTACT_EMAIL}.`,
  unavailable: `The assistant is unavailable right now — please try again later or email ${CONTACT_EMAIL}.`,
  emptyAnswer: `Sorry, I couldn't put together an answer to that. You can email Mayuresh at ${CONTACT_EMAIL}.`,
} as const;

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/**
 * Canonical form for comparing origins: lowercase scheme/host, no trailing slash, no default port.
 * Tolerates stray quotes and whitespace. "null" (file:// pages) is kept as-is.
 */
export function normalizeOrigin(raw: string): string {
  const value = raw.trim().replace(/^["']+|["']+$/g, "").trim();
  if (!value || value.toLowerCase() === "null") return value.toLowerCase();
  try {
    return new URL(value).origin;
  } catch {
    return value.replace(/\/+$/, "").toLowerCase();
  }
}

export const config = {
  get geminiApiKey() {
    return env("GEMINI_API_KEY");
  },
  get geminiModel() {
    return env("GEMINI_MODEL") ?? DEFAULT_GEMINI_MODEL;
  },
  get groqApiKey() {
    return env("GROQ_API_KEY");
  },
  get groqModel() {
    return env("GROQ_MODEL");
  },
  get portfolioUrl() {
    return env("PORTFOLIO_URL");
  },
  get allowedOrigins(): string[] {
    return (env("ALLOWED_ORIGINS") ?? "")
      .split(",")
      .map(normalizeOrigin)
      .filter(Boolean);
  },
  get mongodbUri() {
    return env("MONGODB_URI");
  },
  get mongodbDb() {
    return env("MONGODB_DB") ?? "portfolio_chat";
  },
  /** Local dev only: DNS servers for mongodb+srv lookups when the system resolver refuses SRV queries. */
  get mongodbDnsServers(): string[] {
    return (env("MONGODB_DNS_SERVERS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  },
  /** Secret salt for hashing IPs in rate-limit keys. Without it, the MongoDB limiter is not used. */
  get rateLimitSalt() {
    return env("RATE_LIMIT_SALT");
  },
  /** True for `vercel dev` (VERCEL_ENV=development) or plain local runs. */
  get isLocalDev() {
    return isLocalDevEnv();
  },
};
