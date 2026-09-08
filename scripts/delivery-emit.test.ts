import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

// The compatibility entry point only forwards arguments and the product's exit
// status. Real installed event execution is covered by pr-athena-delivery-run.
async function invokeAdapter(args: string[], exitCode: number) {
  const root = await mkdtemp(path.join(tmpdir(), "athena-emit-adapter-"));
  roots.push(root);
  await cp(path.join(repoRoot, "scripts/delivery-emit.ts"), path.join(root, "delivery-emit.ts"));
  await writeFile(path.join(root, "delivery-product.ts"), `
export async function runDeliveryProduct(args: string[]) {
  console.log(JSON.stringify(args));
  return ${exitCode};
}
`);
  const child = Bun.spawn(["bun", path.join(root, "delivery-emit.ts"), ...args], {
    cwd: root, stdout: "pipe", stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  return { code, args: JSON.parse(stdout), stderr };
}

describe("delivery emit compatibility entry point", () => {
  it("forwards explicit JSON and run selection without rewriting argument boundaries", async () => {
    const args = ["decision.recorded", "--run", "run-abc", "--json", '{"fork":"branch name","choice":"x"}'];
    const result = await invokeAdapter(args, 0);
    expect(result.args).toEqual(["emit", ...args]);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
  });

  it.each([{ args: [] }, { args: ["run.started", "--json", "invalid-json"] }])(
    "leaves invalid input validation and failure status to the product: %j",
    async ({ args }) => {
      const result = await invokeAdapter(args, 2);
      expect(result.args).toEqual(["emit", ...args]);
      expect(result.code).toBe(2);
    },
  );

  it("routes the public command directly to the installed product adapter", async () => {
    const { scripts } = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
    expect(scripts["delivery:emit"]).toBe("bun scripts/delivery-product.ts emit");
    expect(scripts["agent-skills:install"]).toBe("bun scripts/agent-skills-install.ts");
  });
});
