/**
 * Register sessions are reconciled against a specific trading day, so the
 * weekday matters when reading when one opened or closed — "Wed, Apr 29"
 * answers a question "Apr 29" leaves open. `dateStyle` cannot be combined
 * with a `weekday` component, so these spell the parts out.
 */

export function formatRegisterSessionTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatRegisterSessionDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatRegisterSessionDayAndTime(timestamp: number) {
  return new Date(timestamp).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
