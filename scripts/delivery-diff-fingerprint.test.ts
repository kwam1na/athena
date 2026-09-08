import { afterEach, expect, it } from "vitest";
import {
  chmodSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  collectChangedPathsForDiff,
  collectDeliverableDiffFingerprint,
} from "./delivery-diff-fingerprint";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(
    path.join(tmpdir(), "athena-documentation-fingerprint-"),
  );
  roots.push(root);
  for (const args of [
    ["init"],
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--allow-empty",
      "-m",
      "base",
    ],
  ]) {
    const result = Bun.spawnSync(["git", ...args], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  }
  return root;
}
it("preserves legal Git paths including newline, trailing space and literal backslashes", () => {
  const root = fixture();
  const names = ["a\nb.ts", "a.ts ", "docs\\reports\\work.ts"];
  for (const name of names) writeFileSync(path.join(root, name), "one");
  expect(collectChangedPathsForDiff(root, "HEAD")).toEqual([...names].sort());
  const before = collectDeliverableDiffFingerprint(root, "HEAD", names);
  writeFileSync(path.join(root, names[2]), "two");
  expect(collectDeliverableDiffFingerprint(root, "HEAD", names)).not.toBe(
    before,
  );
});
it("binds executable modes, deleted files and dangling symlink targets", () => {
  const root = fixture();
  writeFileSync(path.join(root, "code.ts"), "same");
  const original = collectDeliverableDiffFingerprint(root, "HEAD", ["code.ts"]);
  chmodSync(path.join(root, "code.ts"), 0o755);
  expect(collectDeliverableDiffFingerprint(root, "HEAD", ["code.ts"])).not.toBe(
    original,
  );
  rmSync(path.join(root, "code.ts"));
  const deleted = collectDeliverableDiffFingerprint(root, "HEAD", ["code.ts"]);
  symlinkSync("missing", path.join(root, "code.ts"));
  expect(collectDeliverableDiffFingerprint(root, "HEAD", ["code.ts"])).not.toBe(
    deleted,
  );
});
it("keeps Athena report and generated exclusions separate from implementation changes", () => {
  const root = fixture();
  const before = collectDeliverableDiffFingerprint(root, "HEAD", []);
  expect(
    collectDeliverableDiffFingerprint(root, "HEAD", [
      "docs/reports/x.html",
      "graphify-out/x",
      "app/_generated/api.ts",
    ]),
  ).toBe(before);
  expect(() =>
    collectDeliverableDiffFingerprint(root, "missing-base", []),
  ).toThrow();
});
