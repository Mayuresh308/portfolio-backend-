import { CONVERSATION_ID_RE, LIMITS } from "./config.js";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ValidationResult =
  | { ok: true; messages: ChatMessage[]; conversationId?: string; messageIndex?: number }
  | { ok: false; error: string };

export type FeedbackResult =
  | { ok: true; conversationId: string; messageIndex: number; rating: "up" | "down" }
  | { ok: false; error: string };

function isMessageIndex(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= LIMITS.maxMessageIndex;
}

export function validateChatBody(raw: string): ValidationResult {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Body must be valid JSON." };
  }

  const { messages, conversationId, messageIndex } = (body ?? {}) as {
    messages?: unknown;
    conversationId?: unknown;
    messageIndex?: unknown;
  };
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

  // Optional: lets logs be grouped per conversation and joined with feedback.
  if (conversationId !== undefined && (typeof conversationId !== "string" || !CONVERSATION_ID_RE.test(conversationId))) {
    return { ok: false, error: "conversationId must be 8-64 characters of letters, digits, '-' or '_'." };
  }
  if (messageIndex !== undefined && !isMessageIndex(messageIndex)) {
    return { ok: false, error: `messageIndex must be an integer from 0 to ${LIMITS.maxMessageIndex}.` };
  }

  return { ok: true, messages: clean, conversationId, messageIndex };
}

/** Strict: exactly { conversationId, messageIndex, rating }. */
export function validateFeedbackBody(raw: string): FeedbackResult {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Body must be valid JSON." };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Body must be a JSON object." };
  }

  const allowed = new Set(["conversationId", "messageIndex", "rating"]);
  if (Object.keys(body).some((k) => !allowed.has(k))) {
    return { ok: false, error: "Only conversationId, messageIndex and rating are allowed." };
  }

  const { conversationId, messageIndex, rating } = body as Record<string, unknown>;
  if (typeof conversationId !== "string" || !CONVERSATION_ID_RE.test(conversationId)) {
    return { ok: false, error: "conversationId must be 8-64 characters of letters, digits, '-' or '_'." };
  }
  if (!isMessageIndex(messageIndex)) {
    return { ok: false, error: `messageIndex must be an integer from 0 to ${LIMITS.maxMessageIndex}.` };
  }
  if (rating !== "up" && rating !== "down") {
    return { ok: false, error: 'rating must be "up" or "down".' };
  }
  return { ok: true, conversationId, messageIndex, rating };
}
