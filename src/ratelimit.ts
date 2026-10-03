import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { config } from "./config.js";
import { describeError, log, logWarn } from "./http.js";

const PER_MINUTE = 10;
const PER_DAY = 60;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export type LimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

interface Limiter {
  check(ip: string): Promise<LimitResult>;
}

class UpstashLimiter implements Limiter {
  private minute: Ratelimit;
  private day: Ratelimit;

  constructor(url: string, token: string) {
    const redis = new Redis({ url, token });
    this.minute = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(PER_MINUTE, "1 m"),
      prefix: "chat:rl:min",
    });
    this.day = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(PER_DAY, "1 d"),
      prefix: "chat:rl:day",
    });
  }

  async check(ip: string): Promise<LimitResult> {
    const [minute, day] = await Promise.all([this.minute.limit(ip), this.day.limit(ip)]);
    for (const r of [minute, day]) {
      if (!r.success) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((r.reset - Date.now()) / 1000)) };
      }
    }
    return { allowed: true };
  }
}

/** Best-effort fallback: state lives in this function instance only and resets on cold start. */
class MemoryLimiter implements Limiter {
  private hits = new Map<string, number[]>();

  async check(ip: string): Promise<LimitResult> {
    const now = Date.now();
    const recent = (this.hits.get(ip) ?? []).filter((t) => now - t < DAY_MS);
    const lastMinute = recent.filter((t) => now - t < MINUTE_MS);

    if (lastMinute.length >= PER_MINUTE) {
      return { allowed: false, retryAfterSeconds: Math.ceil((lastMinute[0] + MINUTE_MS - now) / 1000) };
    }
    if (recent.length >= PER_DAY) {
      return { allowed: false, retryAfterSeconds: Math.ceil((recent[0] + DAY_MS - now) / 1000) };
    }

    recent.push(now);
    this.hits.set(ip, recent);
    if (this.hits.size > 10_000) this.prune(now);
    return { allowed: true };
  }

  private prune(now: number) {
    for (const [ip, times] of this.hits) {
      if (times.every((t) => now - t >= DAY_MS)) this.hits.delete(ip);
    }
  }
}

let limiter: Limiter | undefined;

function getLimiter(): Limiter {
  if (limiter) return limiter;
  const { upstashUrl, upstashToken } = config;
  if (upstashUrl && upstashToken) {
    limiter = new UpstashLimiter(upstashUrl, upstashToken);
    log("ratelimit_init", { backend: "upstash" });
  } else {
    limiter = new MemoryLimiter();
    logWarn("ratelimit_init", {
      backend: "memory",
      note: "UPSTASH_REDIS_REST_URL/TOKEN not set; rate limiting is per-instance only and resets on cold start.",
    });
  }
  return limiter;
}

export async function checkRateLimit(ip: string): Promise<LimitResult> {
  try {
    return await getLimiter().check(ip);
  } catch (err) {
    // If Redis is down, don't take the chat down with it.
    logWarn("ratelimit_error", describeError(err));
    return { allowed: true };
  }
}
