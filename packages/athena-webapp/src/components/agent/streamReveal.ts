/**
 * Stream reveal for model prose, after the chat panel in kwamina-fyi.
 *
 * Each update to the text runs one short linear reveal from the characters
 * already on screen to the new length: the catch-up is brief (70–180 ms while
 * streaming, 70–120 ms once the draft has settled). A final answer arrives as
 * one committed buffer, so its reveal scales linearly with the answer length
 * rather than being compressed into a fixed window. Prefixes are cut on whole
 * code points and never inside a `[citation:…]` key, and every prefix is
 * rendered through the same inert renderer as the full text.
 */

/** One word's ink wipe (the `athena-agent-word-ink` animation in index.css). */
export const WORD_INK_MS = 760;
export const MIN_REVEAL_MS = 70;
export const MAX_STREAM_REVEAL_MS = 180;
export const MAX_SETTLE_REVEAL_MS = 120;
const STREAM_PACE_MS_PER_CHAR = 10;
const SETTLE_PACE_MS_PER_CHAR = 6;
const ANSWER_PACE_MS_PER_CHAR = 3;

export type RevealMode = "streaming" | "settling" | "answer";

/** How long pending prose takes to land for each stage of the turn. */
export function revealDuration(
  pendingCharacters: number,
  mode: RevealMode,
): number {
  if (pendingCharacters <= 0) return 0;
  if (mode === "answer") return pendingCharacters * ANSWER_PACE_MS_PER_CHAR;
  const pace =
    mode === "streaming"
      ? STREAM_PACE_MS_PER_CHAR
      : SETTLE_PACE_MS_PER_CHAR;
  const maximum =
    mode === "streaming" ? MAX_STREAM_REVEAL_MS : MAX_SETTLE_REVEAL_MS;
  return Math.min(
    maximum,
    Math.max(MIN_REVEAL_MS, pendingCharacters * pace),
  );
}

/** The text's length in code points, the unit the reveal counts in. */
export function characterCount(text: string): number {
  return Array.from(text).length;
}

/** The first `characterCount` code points of the text, never a split surrogate pair. */
export function revealedPrefix(text: string, count: number): string {
  return Array.from(text)
    .slice(0, Math.max(0, Math.floor(count)))
    .join("");
}

/**
 * A prefix that never ends inside an unclosed bracket: the narrative carries
 * `[citation:…]` keys, and half a key would read as a broken reference for a
 * frame. The bracket is simply held back until it closes.
 */
export function revealedProse(text: string, count: number): string {
  const prefix = revealedPrefix(text, count);
  const open = prefix.lastIndexOf("[");
  if (open === -1) return prefix;
  const close = prefix.lastIndexOf("]");
  return close > open ? prefix : prefix.slice(0, open);
}
