import { afterEach, describe, expect, it } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(
    path.join(tmpdir(), "athena-installed-lifecycle-"),
  );
  roots.push(root);
  const git = Bun.spawnSync(["git", "init", root], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (git.exitCode !== 0) throw new Error(git.stderr.toString());
  await mkdir(path.join(root, ".agent-skills"));
  await symlink(
    path.resolve(import.meta.dir, "../.agent-skills/current"),
    path.join(root, ".agent-skills/current"),
  );
  await writeFile(
    path.join(root, ".agent-skills/active.json"),
    '{"untouched":"existing-generation"}\n',
  );
  return root;
}
function invoke(root: string, argv: string[]) {
  return Bun.spawnSync(
    ["bun", path.join(import.meta.dir, "agent-skills-install.ts"), ...argv],
    {
      cwd: root,
      env: {
        ...process.env,
        AGENT_SKILLS_CHECKOUT: path.join(
          root,
          "producer-checkout-does-not-exist",
        ),
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
}

describe("installed agent-skills update boundary", () => {
  it("uses the installed lifecycle help without a producer checkout", async () => {
    const root = await fixture();
    const result = invoke(root, ["--help"]);
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(result.stdout.toString()).toContain("agent-skills update");
    expect(result.stdout.toString()).toContain("--archive");
    expect(result.stdout.toString()).toContain("--metadata");
  });
  it("preserves the lifecycle's usage failure for missing artifact metadata", async () => {
    const root = await fixture();
    const result = invoke(root, [
      "--archive",
      path.join(root, "candidate.zip"),
    ]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("--metadata");
    expect(
      await readFile(path.join(root, ".agent-skills/active.json"), "utf8"),
    ).toBe('{"untouched":"existing-generation"}\n');
  });
  it("propagates an unavailable artifact refusal without executing shell text or switching generations", async () => {
    const root = await fixture();
    const result = invoke(root, [
      "--archive",
      "missing archive; touch unexpected-marker",
      "--metadata",
      "missing metadata.json",
    ]);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout.toString())).toMatchObject({
      ok: false,
      error: { code: "source-unavailable" },
    });
    expect(await Bun.file(path.join(root, "unexpected-marker")).exists()).toBe(
      false,
    );
    expect(
      await readFile(path.join(root, ".agent-skills/active.json"), "utf8"),
    ).toBe('{"untouched":"existing-generation"}\n');
  });
});
