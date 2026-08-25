/**
 * Starter-intent program rendering (kernel; pure, browser-safe).
 *
 * A curated starter-intent program is a template whose only holes are the
 * profile's snapshot context keys, written as `{{key}}`. Rendering is closed
 * and fail-closed by construction (plan
 * `docs/plans/2026-08-24-001-feat-compiled-starter-intents-plan.md`, R4):
 * every placeholder must name a snapshot key of the binding, carry an entry in
 * the shape table below, and receive a context value that shape-check passes.
 * A snapshot key with NO shape entry fails closed — a future profile
 * snapshotting a free-text key must never silently render operator-supplied
 * text into program source. The rendered source is validated again at turn
 * time by the executor's own `validateProgramSource` pass; this module is the
 * first lock, not the only one.
 */

export type StarterIntentRenderIssue = { readonly code: string; readonly path: string; readonly message: string };

export type StarterIntentRenderResult =
  | { readonly ok: true; readonly source: string }
  | { readonly ok: false; readonly issues: readonly StarterIntentRenderIssue[] };

const PLACEHOLDER_PATTERN = /\{\{([A-Za-z][A-Za-z0-9_]{0,31})\}\}/g;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Every substitutable key and its value shape. Deliberately tiny: a key earns
 * an entry only when its whole value space is safe inside a string literal of
 * program source.
 */
const SNAPSHOT_KEY_SHAPES: { readonly [key: string]: (value: string) => boolean } = {
  operatingDate: (value) => ISO_DATE_PATTERN.test(value),
};

/** Shape-valid sample values, one per shaped key: what conformance renders with. */
export const STARTER_INTENT_SAMPLE_CONTEXT: { readonly [key: string]: string } = {
  operatingDate: "2026-08-21",
};

export function renderStarterIntentProgram(
  template: string,
  context: { readonly [key: string]: string },
  snapshotKeys: readonly string[],
): StarterIntentRenderResult {
  const issues: StarterIntentRenderIssue[] = [];
  const allowed = new Set(snapshotKeys);
  const source = template.replace(PLACEHOLDER_PATTERN, (whole, key: string) => {
    if (!allowed.has(key)) {
      issues.push({ code: "placeholder_not_snapshot_key", path: key, message: `"${key}" is not a snapshot context key of this profile.` });
      return whole;
    }
    const shape = SNAPSHOT_KEY_SHAPES[key];
    if (!shape) {
      issues.push({ code: "shape_unknown", path: key, message: `"${key}" has no value-shape entry; refusing to render it into program source.` });
      return whole;
    }
    const value = context[key];
    if (value === undefined) {
      issues.push({ code: "value_missing", path: key, message: `The turn context carries no value for "${key}".` });
      return whole;
    }
    if (!shape(value)) {
      issues.push({ code: "value_shape_invalid", path: key, message: `The value for "${key}" does not match its declared shape.` });
      return whole;
    }
    return value;
  });
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, source };
}
