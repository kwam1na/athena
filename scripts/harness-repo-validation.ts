const HARNESS_REPO_VALIDATION_PATTERNS = [
  /^scripts\//,
  /^packages\/[^/]+\/docs\/agent\//,
  /^packages\/[^/]+\/AGENTS\.md$/,
  /^packages\/AGENTS\.md$/,
  /^README\.md$/,
  /^package\.json$/,
  /^manage-athena-versions\.sh$/,
  /^\.github\/workflows\/athena-pr-tests\.yml$/,
  /^\.husky\/pre-commit$/,
  /^\.husky\/pre-push$/,
] as const;

const HARNESS_REPO_VALIDATION_COMMANDS = [
  "bun run harness:test",
  "bun run harness:inferential-review",
] as const;

const HARNESS_REPO_VALIDATION_SURFACE_NAME =
  "repo harness implementation and workflow wiring";

export type HarnessRepoSurfaceCoverage = {
  surfaceName: string;
  files: string[];
};

function normalizeRepoPath(repoPath: string) {
  return repoPath.replaceAll("\\", "/");
}

function sortUniquePaths(paths: string[]) {
  return [...new Set(paths.map((entry) => normalizeRepoPath(entry).trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right)
  );
}

export function matchesHarnessRepoValidationPath(filePath: string) {
  const normalizedPath = normalizeRepoPath(filePath);

  return HARNESS_REPO_VALIDATION_PATTERNS.some((pattern) =>
    pattern.test(normalizedPath)
  );
}

export function collectHarnessRepoValidationSelection(changedFiles: string[]) {
  const matchedFiles = sortUniquePaths(
    changedFiles.filter((filePath) => matchesHarnessRepoValidationPath(filePath))
  );

  return {
    matchedFiles,
    matchedSurfaces:
      matchedFiles.length === 0
        ? []
        : [
            {
              surfaceName: HARNESS_REPO_VALIDATION_SURFACE_NAME,
              files: matchedFiles,
            },
          ],
    selectedCommands:
      matchedFiles.length === 0
        ? []
        : [...HARNESS_REPO_VALIDATION_COMMANDS],
  };
}
