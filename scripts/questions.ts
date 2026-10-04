// Review what visitors ask the chat assistant. Reads MONGODB_URI / MONGODB_DB from .env.local.
//
//   pnpm questions                 last 50 logs (date, answered ✓/✗, question)
//   pnpm questions --unanswered    only questions the notes couldn't answer
//   pnpm questions --feedback      thumbs-down answers with their question
//   pnpm questions --csv <file>    export all logs to CSV
//   pnpm questions --stats         totals, answered %, top 10 unanswered questions
import { writeFileSync } from "node:fs";
import { config } from "../src/config.js";
import { COLLECTIONS, closeDb, getDb, type ChatLogDoc, type FeedbackDoc } from "../src/db.js";
import { loadLocalEnv } from "../src/env.js";

loadLocalEnv();

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}

function csvCell(value: unknown): string {
  const s = value instanceof Date ? value.toISOString() : String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Same question, different casing/spacing/punctuation → one bucket. */
const normalizeExpr = {
  $trim: {
    input: { $replaceAll: { input: { $toLower: "$question" }, find: "  ", replacement: " " } },
    chars: " ?!.\t\n",
  },
};

async function main() {
  if (!config.mongodbUri) {
    console.error("MONGODB_URI is not set (put it in .env.local).");
    process.exit(1);
  }
  const db = await getDb();
  if (!db) return;
  const logs = db.collection<ChatLogDoc>(COLLECTIONS.chatLogs);
  const feedback = db.collection<FeedbackDoc>(COLLECTIONS.feedback);
  console.log(`Database: ${config.mongodbDb}\n`);

  if (has("--csv")) {
    const file = args[args.indexOf("--csv") + 1];
    if (!file || file.startsWith("--")) throw new Error("Usage: pnpm questions --csv <file>");
    const rows = await logs.find({}, { sort: { ts: -1 } }).toArray();
    const header = ["ts", "answered", "question", "answer", "model", "conversationId", "messageIndex"];
    const lines = [header.join(","), ...rows.map((r) => header.map((h) => csvCell(r[h as keyof ChatLogDoc])).join(","))];
    writeFileSync(file, "﻿" + lines.join("\r\n") + "\r\n", "utf8");
    console.log(`Wrote ${rows.length} logs to ${file}`);
    return;
  }

  if (has("--stats")) {
    const [total, answered, up, down, oldest] = await Promise.all([
      logs.countDocuments(),
      logs.countDocuments({ answered: true }),
      feedback.countDocuments({ rating: "up" }),
      feedback.countDocuments({ rating: "down" }),
      logs.find({}, { sort: { ts: 1 }, limit: 1, projection: { ts: 1 } }).next(),
    ]);
    const pct = total ? ((answered / total) * 100).toFixed(1) : "0.0";
    console.log(`Questions logged:  ${total}${oldest ? ` (since ${fmtDate(oldest.ts)} UTC)` : ""}`);
    console.log(`Answered:          ${answered} (${pct}%)`);
    console.log(`Unanswered:        ${total - answered}`);
    console.log(`Feedback:          ${up} up, ${down} down`);

    const top = await logs
      .aggregate<{ _id: string; count: number; last: Date }>([
        { $match: { answered: false } },
        { $group: { _id: normalizeExpr, count: { $sum: 1 }, last: { $max: "$ts" } } },
        { $sort: { count: -1, last: -1 } },
        { $limit: 10 },
      ])
      .toArray();
    console.log(`\nTop unanswered questions:`);
    if (!top.length) console.log("  (none)");
    top.forEach((t, i) => console.log(`  ${String(i + 1).padStart(2)}. ${String(t.count).padStart(3)}×  ${oneLine(t._id, 90)}`));
    return;
  }

  if (has("--feedback")) {
    const rows = await feedback
      .aggregate<FeedbackDoc & { log?: ChatLogDoc }>([
        { $match: { rating: "down" } },
        { $sort: { ts: -1 } },
        { $limit: 50 },
        {
          $lookup: {
            from: COLLECTIONS.chatLogs,
            let: { c: "$conversationId", m: "$messageIndex" },
            pipeline: [
              { $match: { $expr: { $and: [{ $eq: ["$conversationId", "$$c"] }, { $eq: ["$messageIndex", "$$m"] }] } } },
              { $sort: { ts: -1 } },
              { $limit: 1 },
            ],
            as: "log",
          },
        },
        { $set: { log: { $first: "$log" } } },
      ])
      .toArray();
    console.log(`Thumbs-down answers (latest ${rows.length}):`);
    if (!rows.length) console.log("  (none)");
    for (const r of rows) {
      console.log(`\n${fmtDate(r.ts)}  conversation ${r.conversationId} #${r.messageIndex}`);
      console.log(`  Q: ${r.log ? oneLine(r.log.question, 200) : "(no matching log; it may have expired)"}`);
      if (r.log) console.log(`  A: ${oneLine(r.log.answer, 300)}`);
    }
    return;
  }

  const filter = has("--unanswered") ? { answered: false } : {};
  const rows = await logs.find(filter, { sort: { ts: -1 }, limit: 50 }).toArray();
  console.log(`${has("--unanswered") ? "Unanswered questions" : "Questions"} (latest ${rows.length}, UTC):\n`);
  console.log(`${"Date".padEnd(16)}  ✓/✗  Question`);
  console.log(`${"-".repeat(16)}  ---  ${"-".repeat(60)}`);
  for (const r of rows) console.log(`${fmtDate(r.ts)}   ${r.answered ? "✓" : "✗"}   ${oneLine(r.question, 100)}`);
}

main()
  .catch((err) => {
    console.error(`Error: ${(err as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
