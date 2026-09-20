import { posix } from "node:path";

/** Ports come from the installed product's pinned tree listing and source reader.
 * This projection supplies planner text; it creates no execution/reuse evidence. */
type TreeEntry = { path: string; mode: string; objectSha: string };
export type SourceReader = ((path: string) => Promise<Uint8Array | null>) & {
  metadata(path: string): Promise<{
    mode: string | null;
    links: readonly { path: string; target: string }[];
  }>;
};
const safe = (path: string) =>
  path.length > 0 &&
  !posix.isAbsolute(path) &&
  !path.includes("\\") &&
  !path.split("/").includes("..") &&
  !/[\x00-\x1f]/.test(path);

export type ValidationSourceSnapshot = {
  files: Record<string, string>;
  /** Native-qualified immediate link targets, normalized relative to repo root. */
  links: Record<string, string>;
};

export async function captureValidationSnapshot(
  entries: readonly TreeEntry[],
  read: SourceReader,
  // Invocation-local only. Equal Git object IDs name identical verified bytes;
  // nothing here allows a check result to be reused.
  regularBlobText = new Map<string, string>(),
): Promise<ValidationSourceSnapshot> {
  const paths = new Set(entries.map((entry) => entry.path));
  if (
    paths.size !== entries.length ||
    entries.some((entry) => !safe(entry.path))
  )
    throw new Error("Invalid pinned tree inventory");
  const result: Record<string, string> = Object.create(null);
  const links: Record<string, string> = Object.create(null);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor++;
      if (index >= entries.length) return;
      const entry = entries[index];
      if (entry.mode === "120000") {
        // Calling metadata first retains native cycle/escape checks, including
        // directory links whose target has no direct ls-tree file entry.
        const metadata = await read.metadata(entry.path);
        let target = entry.path;
        for (const link of metadata.links) {
          if (target !== link.path && !target.startsWith(`${link.path}/`))
            throw new Error("Inconsistent native link metadata");
          target = posix.normalize(
            posix.join(
              posix.dirname(link.path),
              link.target,
              target.slice(link.path.length),
            ),
          );
          if (!safe(target))
            throw new Error("Native link target escapes inventory");
        }
        if (
          !metadata.links.length ||
          (!paths.has(target) &&
            !entries.some((file) => file.path.startsWith(`${target}/`)))
        )
          throw new Error(`Dangling source link: ${entry.path}`);
        const own = metadata.links[0];
        if (own.path !== entry.path)
          throw new Error("Inconsistent native link origin");
        // Only the committed link's own target is file identity. Downstream link
        // and target changes have their own paths in the complete snapshot.
        result[entry.path] = `\u0000symlink:${own.target}`;
        links[entry.path] = posix.normalize(
          posix.join(posix.dirname(entry.path), own.target),
        );
        continue;
      }
      if (!/^100(?:644|755)$/.test(entry.mode))
        throw new Error(`Unsupported source tree mode: ${entry.path}`);
      let text = regularBlobText.get(entry.objectSha);
      if (text === undefined) {
        const bytes = await read(entry.path);
        if (bytes === null)
          throw new Error(`Missing pinned source input: ${entry.path}`);
        try {
          text = new TextDecoder("utf-8", {
            fatal: true,
            ignoreBOM: true,
          }).decode(bytes);
        } catch {
          text = `\u0000binary-base64:${Buffer.from(bytes).toString("base64")}`;
        }
        // A leading NUL is reserved for lossless non-text and link projections.
        if (bytes[0] === 0)
          text = `\u0000binary-base64:${Buffer.from(bytes).toString("base64")}`;
        regularBlobText.set(entry.objectSha, text);
      }
      result[entry.path] = text;
    }
  }
  // Bound child Git pressure while allowing independent blob reads to overlap.
  await Promise.all(
    Array.from({ length: Math.min(8, entries.length) }, worker),
  );
  const ordered = (values: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(values).sort(([a], [b]) => a.localeCompare(b)),
    );
  return { files: ordered(result), links: ordered(links) };
}
