import { LIMITS } from "./config.js";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ValidationResult =
  | { ok: true; messages: ChatMessage[] }
  | { ok: false; error: string };

export function validateChatBody(raw: string): ValidationResult {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Body must be valid JSON." };
  }

  const messages = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(messages)) {
    return { ok: false, error: "Body must be { messages: [...] }." };
  }
  if (messages.length < 1 || messages.length > LIMITS.maxMessages) {
    return { ok: false, error: `Send between 1 and ${LIMITS.maxMessages} messages.` };
  }

  const clean: ChatMessage[] = [];
  let total = 0;
  for (const m of messages) {
    const role = (m as { role?: unknown })?.role;
    const content = (m as { content?: unknown })?.content;
    if (role !== "user" && role !== "assistant") {
      return { ok: false, error: 'Each message role must be "user" or "assistant".' };
    }
    if (typeof content !== "string") {
      return { ok: false, error: "Each message content must be a string." };
    }
    if (content.length > LIMITS.maxMessageChars) {
      return { ok: false, error: `Each message must be at most ${LIMITS.maxMessageChars} characters.` };
    }
    total += content.length;
    clean.push({ role, content });
  }

  if (total > LIMITS.maxTotalChars) {
    return { ok: false, error: `Conversation must be at most ${LIMITS.maxTotalChars} characters in total.` };
  }
  const last = clean[clean.length - 1];
  if (last.role !== "user") {
    return { ok: false, error: "The last message must be from the user." };
  }
  if (!last.content.trim()) {
    return { ok: false, error: "The last message must not be empty." };
  }

  return { ok: true, messages: clean };
}
