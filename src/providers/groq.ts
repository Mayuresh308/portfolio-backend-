import { config } from "../config.js";
import { ProviderError, type StreamParams } from "./types.js";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export function groqConfigured(): boolean {
  return Boolean(config.groqApiKey && config.groqModel);
}

/** Streams from Groq's OpenAI-compatible chat completions endpoint using plain fetch + SSE parsing. */
export async function* streamGroq({ systemPrompt, messages, maxOutputTokens, signal }: StreamParams): AsyncGenerator<string> {
  const model = config.groqModel!;
  const isReasoningModel = model.startsWith("openai/gpt-oss");

  const res = await fetch(GROQ_URL, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.groqApiKey}`,
    },
    body: JSON.stringify({
      model,
      stream: true,
      temperature: 0.2,
      max_completion_tokens: maxOutputTokens,
      ...(isReasoningModel ? { reasoning_effort: "low", include_reasoning: false } : {}),
      messages: [{ role: "system", content: systemPrompt }, ...messages],
    }),
  });

  if (!res.ok || !res.body) {
    // Don't surface the provider's error body anywhere.
    await res.body?.cancel().catch(() => {});
    throw new ProviderError("groq", res.status, `Groq request failed with HTTP ${res.status}`);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;

      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith("data:")) continue;

        const data = line.slice(5).trim();
        if (data === "[DONE]") return;

        let parsed: { choices?: { delta?: { content?: string } }[]; error?: unknown };
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }
        if (parsed.error) throw new ProviderError("groq", 502, "Groq stream returned an error event");
        const text = parsed.choices?.[0]?.delta?.content;
        if (text) yield text;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
