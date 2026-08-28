import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

export type ContainedPathState = "file" | "directory" | "symlink" | "absent";

export class PortableBaselinePathContainmentError extends Error {
  readonly code = "path-containment-escape";

  constructor(readonly relativePath: string) {
    super(`Path ${relativePath} resolves outside the repository root.`);
    this.name = "PortableBaselinePathContainmentError";
  }
}

function isMissingPathError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function isContainedBy(rootPath: string, candidatePath: string) {
  const relative = path.relative(rootPath, candidatePath);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

function assertContained(
  rootPath: string,
  candidatePath: string,
  relativePath: string,
) {
  if (!isContainedBy(rootPath, candidatePath)) {
    throw new PortableBaselinePathContainmentError(relativePath);
  }
}

function repositoryRelativeIdentity(rootPath: string, candidatePath: string) {
  return path.relative(rootPath, candidatePath).split(path.sep).join("/");
}

async function nearestExistingAncestor(absolutePath: string, rootPath: string) {
  let candidate = absolutePath;
  while (isContainedBy(rootPath, candidate)) {
    try {
      return await realpath(candidate);
    } catch (error: unknown) {
      if (!isMissingPathError(error)) throw error;
    }
    if (candidate === rootPath) return rootPath;
    candidate = path.dirname(candidate);
  }
  return candidate;
}

export async function resolveContainedPath(
  rootDir: string,
  relativePath: string,
  options: { allowExternalLeafSymlinkMetadata?: boolean } = {},
): Promise<{
  absolutePath: string;
  identityPath: string | null;
  realRoot: string;
  state: ContainedPathState;
}> {
  const realRoot = await realpath(rootDir);
  const absolutePath = path.resolve(realRoot, relativePath);
  assertContained(realRoot, absolutePath, relativePath);

  let stat: Awaited<ReturnType<typeof lstat>>;
  try {
    stat = await lstat(absolutePath);
  } catch (error: unknown) {
    if (!isMissingPathError(error)) throw error;
    const ancestor = await nearestExistingAncestor(
      path.dirname(absolutePath),
      realRoot,
    );
    assertContained(realRoot, ancestor, relativePath);
    return { absolutePath, identityPath: null, realRoot, state: "absent" };
  }

  if (stat.isSymbolicLink()) {
    const realParent = await realpath(path.dirname(absolutePath));
    assertContained(realRoot, realParent, relativePath);
    // A leaf symlink's identity canonicalizes its contained real parent but
    // deliberately retains the authored leaf name. This keeps external link
    // targets metadata-only rather than dereferencing them for identity.
    const identityPath = repositoryRelativeIdentity(
      realRoot,
      path.join(realParent, path.basename(absolutePath)),
    );
    if (!options.allowExternalLeafSymlinkMetadata) {
      let realTarget: string;
      try {
        realTarget = await realpath(absolutePath);
      } catch (error: unknown) {
        if (isMissingPathError(error)) {
          return { absolutePath, identityPath, realRoot, state: "symlink" };
        }
        throw error;
      }
      assertContained(realRoot, realTarget, relativePath);
    }
    return { absolutePath, identityPath, realRoot, state: "symlink" };
  }

  const realTarget = await realpath(absolutePath);
  assertContained(realRoot, realTarget, relativePath);
  return {
    absolutePath,
    identityPath: repositoryRelativeIdentity(realRoot, realTarget),
    realRoot,
    state: stat.isDirectory() ? "directory" : "file",
  };
}
