// Central place for env-driven settings and fixed limits.

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

export const CONTACT_EMAIL = "mayureshmayuresh56@gmail.com";

export const LIMITS = {
  maxBodyBytes: 10 * 1024,
  maxMessages: 12,
  maxMessageChars: 600,
  maxTotalChars: 4000,
  maxOutputTokens: 400,
} as const;

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
      .map((o) => o.trim().replace(/\/+$/, ""))
      .filter(Boolean);
  },
  get upstashUrl() {
    return env("UPSTASH_REDIS_REST_URL");
  },
  get upstashToken() {
    return env("UPSTASH_REDIS_REST_TOKEN");
  },
  /** True for `vercel dev` (VERCEL_ENV=development) or plain local runs. */
  get isLocalDev() {
    const v = env("VERCEL_ENV");
    return v === undefined || v === "development";
  },
};
