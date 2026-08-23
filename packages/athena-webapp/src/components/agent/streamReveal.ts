/**
 * Stream reveal for model prose, after the chat panel in kwamina-fyi.
 *
 * Each update to the text runs one short linear reveal from the characters
 * already on screen to the new length: the catch-up is brief (70–180 ms while
 * streaming, 70–120 ms once the text has settled), so the painted prefix is
 * never far behind the buffer, and a new flush restarts the reveal from the
 * current prefix rather than from the start. Prefixes are cut on whole code
 * points and never inside a `[citation:…]` key, and every prefix is rendered
 * through the same inert renderer as the full text.
 */

export const MIN_REVEAL_MS = 70;
export const MAX_STREAM_REVEAL_MS = 180;
export const MAX_SETTLE_REVEAL_MS = 120;
const STREAM_PACE_MS_PER_CHAR = 10;
const SETTLE_PACE_MS_PER_CHAR = 6;

/** How long the pending tail takes to land: brief while streaming, brisker once settled. */
export function revealDuration(pendingCharacters: number, isStreaming: boolean): number {
  if (pendingCharacters <= 0) return 0;
  const pace = isStreaming ? STREAM_PACE_MS_PER_CHAR : SETTLE_PACE_MS_PER_CHAR;
  const maximum = isStreaming ? MAX_STREAM_REVEAL_MS : MAX_SETTLE_REVEAL_MS;
  return Math.min(maximum, Math.max(MIN_REVEAL_MS, pendingCharacters * pace));
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
