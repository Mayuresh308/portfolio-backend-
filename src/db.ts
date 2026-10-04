// MongoDB (Atlas) access shared by rate limiting, chat logs and feedback.
// One MongoClient promise is cached on globalThis so warm invocations reuse the connection pool.
import dns from "node:dns";
import { MongoClient, type Db } from "mongodb";
import { config } from "./config.js";
import { describeError, log, logWarn } from "./http.js";

export const COLLECTIONS = {
  rateLimits: "rate_limits",
  chatLogs: "chat_logs",
  feedback: "chat_feedback",
} as const;

export const RETENTION_SECONDS = 90 * 24 * 60 * 60;

/** After a failure, skip MongoDB for this long so an outage doesn't add a timeout to every request. */
const BACKOFF_MS = 30_000;

export type RateLimitDoc = { _id: string; count: number; expiresAt: Date };

export type ChatLogDoc = {
  ts: Date;
  conversationId?: string;
  messageIndex: number;
  question: string;
  answer: string;
  answered: boolean;
  model: string;
};

export type FeedbackDoc = {
  ts: Date;
  conversationId: string;
  messageIndex: number;
  rating: "up" | "down";
};

type MongoCache = {
  uri?: string;
  client?: Promise<MongoClient>;
  indexes?: Promise<void>;
  downUntil?: number;
};

const globalForMongo = globalThis as typeof globalThis & { __portfolioChatMongo?: MongoCache };
const cache: MongoCache = (globalForMongo.__portfolioChatMongo ??= {});

/** Thrown while backing off after a failure; already reported, so callers needn't log it again. */
export class MongoBackoffError extends Error {
  constructor() {
    super("MongoDB unavailable (backing off after a recent failure)");
    this.name = "MongoBackoffError";
  }
}

export function mongoConfigured(): boolean {
  return Boolean(config.mongodbUri);
}

/** Call when a MongoDB operation fails, so callers fall back for a while instead of waiting on timeouts. */
export function markMongoDown(): void {
  cache.downUntil = Date.now() + BACKOFF_MS;
  cache.client = undefined;
  cache.indexes = undefined;
}

/**
 * The database, or null when MONGODB_URI is unset.
 * Throws if MongoDB is unreachable (or was recently), so callers can fall back.
 */
export async function getDb(): Promise<Db | null> {
  const uri = config.mongodbUri;
  if (!uri) return null;
  if (cache.downUntil && Date.now() < cache.downUntil) throw new MongoBackoffError();

  if (!cache.client || cache.uri !== uri) {
    applyLocalDnsServers();
    cache.uri = uri;
    cache.client = new MongoClient(uri, {
      appName: "portfolio-chat",
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 3000,
      connectTimeoutMS: 5000,
      socketTimeoutMS: 10_000,
    }).connect();
  }

  let client: MongoClient;
  try {
    client = await cache.client;
  } catch (err) {
    markMongoDown();
    throw err;
  }

  const db = client.db(config.mongodbDb);
  // Once per cold start; not awaited so the first request isn't slowed down.
  cache.indexes ??= ensureIndexes(db).catch((err) => {
    cache.indexes = undefined;
    logWarn("mongo_index_error", describeError(err));
  });
  return db;
}

let dnsApplied = false;

/**
 * Local dev only: some machines' resolvers (e.g. a local DNS proxy on 127.0.0.1) refuse the SRV lookups
 * that mongodb+srv:// needs. MONGODB_DNS_SERVERS=8.8.8.8,1.1.1.1 points Node's resolver elsewhere.
 * Ignored on Vercel deployments.
 */
function applyLocalDnsServers(): void {
  if (dnsApplied) return;
  dnsApplied = true;
  const servers = config.mongodbDnsServers;
  if (!servers.length || !config.isLocalDev) return;
  try {
    dns.setServers(servers);
    log("mongo_dns_servers", { servers });
  } catch (err) {
    logWarn("mongo_dns_servers_invalid", describeError(err));
  }
}

/** createIndex is idempotent when the spec and options are unchanged. */
async function ensureIndexes(db: Db): Promise<void> {
  await Promise.all([
    db.collection(COLLECTIONS.rateLimits).createIndex({ expiresAt: 1 }, { name: "ttl_expiresAt", expireAfterSeconds: 0 }),
    db.collection(COLLECTIONS.chatLogs).createIndex({ ts: 1 }, { name: "ttl_ts_90d", expireAfterSeconds: RETENTION_SECONDS }),
    db.collection(COLLECTIONS.chatLogs).createIndex({ answered: 1, ts: -1 }, { name: "answered_ts" }),
    db.collection(COLLECTIONS.chatLogs).createIndex({ conversationId: 1, messageIndex: 1 }, { name: "conversation_message" }),
    db.collection(COLLECTIONS.feedback).createIndex({ ts: 1 }, { name: "ttl_ts_90d", expireAfterSeconds: RETENTION_SECONDS }),
    db.collection(COLLECTIONS.feedback).createIndex({ rating: 1, ts: -1 }, { name: "rating_ts" }),
  ]);
  log("mongo_indexes_ready", { db: db.databaseName });
}

/** For scripts: close the cached client so the process can exit. */
export async function closeDb(): Promise<void> {
  await cache.indexes; // let first-use index creation finish (it never rejects)
  const pending = cache.client;
  cache.client = undefined;
  cache.indexes = undefined;
  if (pending) await (await pending.catch(() => null))?.close();
}
