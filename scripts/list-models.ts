// Lists Gemini models available to GEMINI_API_KEY that support generateContent.
// Usage: pnpm models   (reads .env.local if present)
import { GoogleGenAI } from "@google/genai";

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local; fall back to the shell environment.
}

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY is not set (put it in .env.local or your shell).");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });
const rows: { name: string; display: string }[] = [];
for await (const model of await ai.models.list({ config: { pageSize: 100 } })) {
  if (!model.supportedActions?.includes("generateContent")) continue;
  rows.push({ name: (model.name ?? "").replace(/^models\//, ""), display: model.displayName ?? "" });
}

rows.sort((a, b) => a.name.localeCompare(b.name));
for (const r of rows) console.log(`${r.name.padEnd(45)} ${r.display}`);

const flash = rows.filter((r) => /flash/.test(r.name) && !/(preview|exp|lite|image|tts|live|audio)/.test(r.name));
console.log(`\nStable Flash candidates: ${flash.map((r) => r.name).join(", ") || "(none found)"}`);
console.log(`Current GEMINI_MODEL: ${process.env.GEMINI_MODEL || "(unset, default gemini-3.8-flash)"}`);
