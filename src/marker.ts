// Handling of the "[[NA]]" marker the model uses when nothing relevant is in the library.
// Visitors never see the marker: the server reads ahead until it's confirmed or ruled out, strips it,
// and reports the result via X-Answered and chat_logs.answered.
import { NA_MARKER } from "./config.js";

/** True while `text` (ignoring leading whitespace) could still turn out to start with the marker. */
function mightBeMarker(text: string): boolean {
  const t = text.trimStart();
  return t.length < NA_MARKER.length && NA_MARKER.startsWith(t);
}

export type MarkerCheck = {
  /** false when the reply started with the marker. */
  answered: boolean;
  /** Text read so far, with a leading marker (and the whitespace after it) removed. */
  head: string;
  /** The stream ended (or failed) while reading ahead. */
  ended: boolean;
  error?: unknown;
};

/** Pulls chunks from `rest` until the start of the reply rules the marker in or out. */
export async function readPastMarker(first: string, rest: AsyncGenerator<string>): Promise<MarkerCheck> {
  let buffer = first;
  let ended = false;
  let error: unknown;
  try {
    while (mightBeMarker(buffer)) {
      const { done, value } = await rest.next();
      if (done) {
        ended = true;
        break;
      }
      buffer += value;
    }
  } catch (err) {
    ended = true;
    error = err;
  }

  const trimmed = buffer.trimStart();
  if (trimmed.startsWith(NA_MARKER)) {
    return { answered: false, head: trimmed.slice(NA_MARKER.length).trimStart(), ended, error };
  }
  return { answered: true, head: buffer, ended, error };
}

/**
 * Removes any later marker occurrences, even when split across chunks, by holding back a trailing
 * fragment that could be the start of one ("[", "[[", "[[N", ...).
 */
export function createMarkerFilter() {
  let carry = "";
  let seen = false;
  return {
    push(chunk: string): string {
      let text = carry + chunk;
      if (text.includes(NA_MARKER)) {
        seen = true;
        text = text.split(NA_MARKER).join("");
      }
      let hold = 0;
      for (let k = Math.min(NA_MARKER.length - 1, text.length); k > 0; k--) {
        if (NA_MARKER.startsWith(text.slice(-k))) {
          hold = k;
          break;
        }
      }
      carry = text.slice(text.length - hold);
      return text.slice(0, text.length - hold);
    },
    flush(): string {
      const rest = carry;
      carry = "";
      return rest;
    },
    /** Whether a marker showed up after the start (the model misplaced it). */
    get seenLater() {
      return seen;
    },
  };
}
