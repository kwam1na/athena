import { describe, expect, it } from "vitest";
import { captureValidationSnapshot } from "./harness-validation-snapshot";

const entry = (path: string, mode = "100644", objectSha = path) => ({
  path,
  mode,
  objectSha,
});
const reader = (
  files: Record<string, string | Uint8Array>,
  links: Record<string, { path: string; target: string }[]> = {},
) =>
  Object.assign(
    async (path: string) =>
      files[path] === undefined
        ? null
        : typeof files[path] === "string"
          ? Buffer.from(files[path])
          : (files[path] as Uint8Array),
    {
      metadata: async (path: string) => ({
        mode: files[path] === undefined ? null : "100644",
        links: links[path] ?? [],
      }),
    },
  );

describe("pinned validation source snapshots", () => {
  it("captures complete source and binary inputs without lossy byte equality", async () => {
    const result = await captureValidationSnapshot(
      [entry("src/a.ts"), entry("asset.bin")],
      reader({
        "src/a.ts": "export const a = 1",
        "asset.bin": new Uint8Array([0xff, 0xfe]),
      }),
    );
    expect(result.files["src/a.ts"]).toBe("export const a = 1");
    expect(result.files["asset.bin"]).toBe("\u0000binary-base64://4=");
  });
  it("preserves contained directory link metadata and inventories the physical target", async () => {
    const result = await captureValidationSnapshot(
      [entry(".agents/skills", "120000"), entry("skills/a.md")],
      reader(
        { "skills/a.md": "instruction" },
        { ".agents/skills": [{ path: ".agents/skills", target: "../skills" }] },
      ),
    );
    expect(result.files[".agents/skills"]).toContain("../skills");
    expect(result.files["skills/a.md"]).toBe("instruction");
  });
  it("keeps link identity separate from target text and preserves BOM differences", async () => {
    const source = reader(
      {
        "alias.ts": "import './dependency';",
        "actual.ts": "import './dependency';",
        "bom.txt": "\ufefftext",
      },
      { "alias.ts": [{ path: "alias.ts", target: "actual.ts" }] },
    );
    const snapshot = await captureValidationSnapshot(
      [entry("alias.ts", "120000"), entry("actual.ts"), entry("bom.txt")],
      source,
    );
    expect(snapshot.files["alias.ts"]).toBe("\u0000symlink:actual.ts");
    expect(snapshot.links).toEqual({ "alias.ts": "actual.ts" });
    expect(snapshot.files["bom.txt"]).toBe("\ufefftext");
  });
  it("refuses dangling directory links and nonregular tree entries", async () => {
    await expect(
      captureValidationSnapshot(
        [entry("alias", "120000")],
        reader({}, { alias: [{ path: "alias", target: "missing" }] }),
      ),
    ).rejects.toThrow("Dangling");
    await expect(
      captureValidationSnapshot([entry("submodule", "160000")], reader({})),
    ).rejects.toThrow("Unsupported");
  });
  it("propagates native source integrity and containment refusals", async () => {
    const read = reader({});
    read.metadata = async () => {
      throw new Error("native symlink escapes");
    };
    await expect(
      captureValidationSnapshot([entry("alias", "120000")], read),
    ).rejects.toThrow("native symlink escapes");
    await expect(
      captureValidationSnapshot([entry("missing.ts")], reader({})),
    ).rejects.toThrow("Missing");
  });
  it("shares only immutable native-verified regular blobs across pinned trees", async () => {
    const cache = new Map<string, string>();
    let calls = 0;
    const source = reader({ "a.ts": "text" });
    const read = Object.assign(
      async (path: string) => {
        calls++;
        return source(path);
      },
      { metadata: source.metadata },
    );
    await captureValidationSnapshot(
      [entry("a.ts", "100644", "same-blob")],
      read,
      cache,
    );
    const next = await captureValidationSnapshot(
      [entry("b.ts", "100755", "same-blob")],
      read,
      cache,
    );
    expect(calls).toBe(1);
    expect(next.files["b.ts"]).toBe("text");
  });
});
