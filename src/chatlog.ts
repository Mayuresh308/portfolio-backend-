// Question logging and feedback storage. Both are best-effort: errors are logged (without content)
// and swallowed, and nothing happens when MONGODB_URI is unset.
// Stored fields are deliberately minimal: no IP, IP hash, user agent, or other identifiers
// besides the client's random conversationId.
import { UNANSWERED_PREFIX } from "./config.js";
import { COLLECTIONS, MongoBackoffError, getDb, type ChatLogDoc, type FeedbackDoc } from "./db.js";
import { describeError, logWarn } from "./http.js";

const ANSWER_LOG_CHARS = 500;

/** True when the reply opens with the fixed "not in the notes" phrase (straight or curly apostrophe). */
export function isUnanswered(answer: string): boolean {
  return answer.trimStart().replace(/[‘’]/g, "'").startsWith(UNANSWERED_PREFIX);
}

export async function logChat(entry: {
  conversationId?: string;
  messageIndex: number;
  question: string;
  answer: string;
  model: string;
}): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.collection<ChatLogDoc>(COLLECTIONS.chatLogs).insertOne({
      ts: new Date(),
      ...(entry.conversationId ? { conversationId: entry.conversationId } : {}),
      messageIndex: entry.messageIndex,
      question: entry.question,
      answer: entry.answer.slice(0, ANSWER_LOG_CHARS),
      answered: !isUnanswered(entry.answer),
      model: entry.model,
    });
  } catch (err) {
    if (!(err instanceof MongoBackoffError)) logWarn("chat_log_error", describeError(err));
  }
}

export async function saveFeedback(entry: Omit<FeedbackDoc, "ts">): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.collection<FeedbackDoc>(COLLECTIONS.feedback).insertOne({ ts: new Date(), ...entry });
  } catch (err) {
    if (!(err instanceof MongoBackoffError)) logWarn("feedback_save_error", describeError(err));
  }
}
