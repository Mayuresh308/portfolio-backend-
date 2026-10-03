import { config } from "../src/config.js";
import { json } from "../src/http.js";

export function GET(): Response {
  return json({ ok: true, model: config.geminiModel }, 200);
}
