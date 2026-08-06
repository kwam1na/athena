export const SECURITY_SOLUTION_CATEGORY = "security-issues";

export function canAccessSolutionCategory(
  category: string,
  isAuthenticated: boolean,
): boolean {
  return category !== SECURITY_SOLUTION_CATEGORY || isAuthenticated;
}

export function filterAccessibleSolutionDocs<T extends { category: string }>(
  docs: readonly T[],
  isAuthenticated: boolean,
): T[] {
  return docs.filter((doc) =>
    canAccessSolutionCategory(doc.category, isAuthenticated),
  );
}
