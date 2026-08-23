/**
 * Shared so Convex and the web app render short dates identically. Convex code
 * should keep importing this through `convex/utils`, which re-exports it.
 */
export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
