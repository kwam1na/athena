/**
 * Shared so Convex and the web app title-case identically. Convex code should
 * keep importing this through `convex/utils`, which re-exports it.
 */
export function capitalizeWords(str: string): string {
  if (!str) return str;
  return str
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}
