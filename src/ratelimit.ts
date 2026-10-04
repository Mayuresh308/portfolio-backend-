import { createHash } from "node:crypto";
import { config } from "./config.js";
import { COLLECTIONS, MongoBackoffError, getDb, markMongoDown, type RateLimitDoc } from "./db.js";
import { describeError, log, logWarn } from "./http.js";

const PER_MINUTE = 10;
const PER_DAY = 60;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** Keep counters a little past their window so TTL cleanup never races the window end. */
const TTL_GRACE_MS = 5 * MINUTE_MS;

export type LimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

function denied(windowEndMs: number, now: number): LimitResult {
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((windowEndMs - now) / 1000)) };
}

/**
 * Fixed-window counters in MongoDB ("rate_limits"), keyed by a salted SHA-256 of the IP.
 * The raw IP is never stored.
 */
async function checkMongo(ip: string, salt: string): Promise<LimitResult | null> {
  const db = await getDb();
  if (!db) return null;

  const ipHash = createHash("sha256").update(salt).update("\0").update(ip).digest("hex");
  const now = Date.now();
  const minute = Math.floor(now / MINUTE_MS);
  const day = Math.floor(now / DAY_MS);
  const minuteEnd = (minute + 1) * MINUTE_MS;
  const dayEnd = (day + 1) * DAY_MS;
  const counters = db.collection<RateLimitDoc>(COLLECTIONS.rateLimits);

  const bump = async (id: string, windowEnd: number): Promise<number> => {
    const update = () =>
      counters.findOneAndUpdate(
        { _id: id },
        { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(windowEnd + TTL_GRACE_MS) } },
        { upsert: true, returnDocument: "after", projection: { count: 1 } },
      );
    try {
      return (await update())?.count ?? 1;
    } catch (err) {
      // Two concurrent upserts of a new window can collide on _id; the retry finds the document.
      if ((err as { code?: number }).code === 11000) return (await update())?.count ?? 1;
      throw err;
    }
  };

  const [perMinute, perDay] = await Promise.all([
    bump(`${ipHash}:m:${minute}`, minuteEnd),
    bump(`${ipHash}:d:${day}`, dayEnd),
  ]);
  if (perMinute > PER_MINUTE) return denied(minuteEnd, now);
  if (perDay > PER_DAY) return denied(dayEnd, now);
  return { allowed: true };
}

/** Best-effort fallback: state lives in this function instance only and resets on cold start. */
class MemoryLimiter {
  private hits = new Map<string, number[]>();

  check(ip: string): LimitResult {
    const now = Date.now();
    const recent = (this.hits.get(ip) ?? []).filter((t) => now - t < DAY_MS);
    const lastMinute = recent.filter((t) => now - t < MINUTE_MS);

    if (lastMinute.length >= PER_MINUTE) return denied(lastMinute[0] + MINUTE_MS, now);
    if (recent.length >= PER_DAY) return denied(recent[0] + DAY_MS, now);

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

const memory = new MemoryLimiter();
let announced = false;

function announce(backend: "mongodb" | "memory", reason?: string) {
  if (announced) return;
  announced = true;
  if (backend === "mongodb") log("ratelimit_init", { backend });
  else logWarn("ratelimit_init", { backend, note: `${reason} Rate limiting is per-instance only and resets on cold start.` });
}

export async function checkRateLimit(ip: string): Promise<LimitResult> {
  const salt = config.rateLimitSalt;
  if (!config.mongodbUri || !salt) {
    announce("memory", !config.mongodbUri ? "MONGODB_URI not set." : "RATE_LIMIT_SALT not set, so IPs can't be hashed safely.");
    return memory.check(ip);
  }

  try {
    const result = await checkMongo(ip, salt);
    if (result) {
      announce("mongodb");
      return result;
    }
  } catch (err) {
    // Never block the chat because the database is down: fall back to the in-memory limiter.
    if (!(err instanceof MongoBackoffError)) {
      logWarn("ratelimit_mongo_error", describeError(err));
      markMongoDown();
    }
  }
  return memory.check(ip);
}
