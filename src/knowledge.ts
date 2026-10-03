import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Loaded once per cold start. vercel.json bundles knowledge/** into the chat function.
const KNOWLEDGE_DIR = path.join(process.cwd(), "knowledge");

let cached: string | undefined;

export function loadKnowledge(): string {
  if (cached !== undefined) return cached;

  const files = readdirSync(KNOWLEDGE_DIR)
    .filter((f) => f.toLowerCase().endsWith(".md") && f.toLowerCase() !== "readme.md")
    .sort();

  cached = files
    .map((file) => {
      const text = readFileSync(path.join(KNOWLEDGE_DIR, file), "utf8")
        // HTML comments are notes to the author ("add more bullets"), not facts.
        .replace(/<!--[\s\S]*?-->/g, "")
        .trim();
      return `### ${file}\n\n${text}`;
    })
    .join("\n\n");

  return cached;
}
