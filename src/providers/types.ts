import type { ChatMessage } from "../validate.js";

export type StreamParams = {
  systemPrompt: string;
  messages: ChatMessage[];
  maxOutputTokens: number;
  signal?: AbortSignal;
};

/** Yields answer text chunks. Throws ProviderError for HTTP failures from the provider. */
export type StreamFn = (params: StreamParams) => AsyncGenerator<string>;

export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
