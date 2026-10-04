// Local-dev env loading.
//
// `vercel dev` (CLI 62.x) only reads `.env`. If that file is missing it injects the linked
// project's cloud "Development" env vars instead, and never reads `.env.local`. So in local dev
// we load `.env.local` ourselves, and it wins over whatever `vercel dev` injected.
// On Vercel deployments (VERCEL_ENV = production/preview) this does nothing.
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

export const LOCAL_ENV_FILE = ".env.local";

export function isLocalDevEnv(): boolean {
  const v = process.env.VERCEL_ENV?.trim();
  return !v || v === "development";
}

let loaded: { file: string | null } | undefined;

/** Loads `.env.local` into process.env once (local dev only). Returns the file used, or null. */
export function loadLocalEnv(): string | null {
  if (loaded) return loaded.file;
  loaded = { file: null };
  if (!isLocalDevEnv()) return null;

  const file = path.join(process.cwd(), LOCAL_ENV_FILE);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }

  // Strip a UTF-8 BOM if an editor added one; parseEnv handles CRLF and quotes.
  const vars = parseEnv(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  for (const [key, value] of Object.entries(vars)) {
    if (value !== undefined) process.env[key] = value;
  }
  loaded.file = file;
  return file;
}
