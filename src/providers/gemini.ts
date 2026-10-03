import { ApiError, GoogleGenAI, ThinkingLevel, type Content } from "@google/genai";
import { config } from "../config.js";
import { ProviderError, type StreamParams } from "./types.js";

let client: GoogleGenAI | undefined;

function getClient(): GoogleGenAI {
  if (!config.geminiApiKey) throw new ProviderError("gemini", 500, "GEMINI_API_KEY is not set");
  client ??= new GoogleGenAI({ apiKey: config.geminiApiKey });
  return client;
}

export async function* streamGemini({ systemPrompt, messages, maxOutputTokens, signal }: StreamParams): AsyncGenerator<string> {
  const model = config.geminiModel;

  // Gemini expects the conversation to start with a user turn; drop any leading widget greeting.
  const firstUser = messages.findIndex((m) => m.role === "user");
  const contents: Content[] = messages.slice(firstUser).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  try {
    const stream = await getClient().models.generateContentStream({
      model,
      contents,
      config: {
        systemInstruction: systemPrompt,
        maxOutputTokens,
        temperature: 0.2,
        abortSignal: signal,
        // On Gemini 3.x, thinking tokens count against maxOutputTokens; keep thinking minimal
        // so the ~400-token budget goes to the answer.
        ...(model.startsWith("gemini-3") ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } } : {}),
      },
    });
    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) yield text;
    }
  } catch (err) {
    if (err instanceof ApiError) throw new ProviderError("gemini", err.status, err.message);
    throw err;
  }
}
