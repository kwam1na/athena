import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectPlanHtmlFindings } from "./validate-plan-html";

const tempDirs: string[] = [];

async function createTempRepo() {
  const dir = await mkdtemp(path.join(tmpdir(), "athena-plan-html-test-"));
  tempDirs.push(dir);
  await mkdir(path.join(dir, "docs/plans"), { recursive: true });
  return dir;
}

describe("validate-plan-html", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("accepts static semantic HTML5 plan artifacts", async () => {
    const rootDir = await createTempRepo();
    await writeFile(
      path.join(rootDir, "docs/plans/plan.html"),
      [
        "<!doctype html>",
        '<html lang="en">',
        "<head>",
        '  <meta charset="utf-8">',
        "  <title>Plan</title>",
        "  <style>main { max-width: 64rem; }</style>",
        "</head>",
        "<body>",
        "  <main>",
        "    <header><h1>Plan</h1></header>",
        "    <section><h2>Summary</h2><p>Review artifact.</p></section>",
        "  </main>",
        "</body>",
        "</html>",
      ].join("\n"),
    );

    await expect(
      collectPlanHtmlFindings(rootDir, ["docs/plans/plan.html"]),
    ).resolves.toEqual([]);
  });

  it("rejects JavaScript and remote assets", async () => {
    const rootDir = await createTempRepo();
    await writeFile(
      path.join(rootDir, "docs/plans/plan.html"),
      [
        "<!doctype html>",
        '<html lang="en">',
        "<head>",
        '  <meta charset="utf-8">',
        "  <title>Plan</title>",
        '  <link rel="stylesheet" href="https://example.com/plan.css">',
        "</head>",
        "<body>",
        "  <main><h1>Plan</h1></main>",
        "  <script>console.log('no');</script>",
        "</body>",
        "</html>",
      ].join("\n"),
    );

    const findings = await collectPlanHtmlFindings(rootDir, [
      "docs/plans/plan.html",
    ]);

    expect(findings.map((finding) => finding.message)).toContain(
      "Plan HTML artifacts must not include JavaScript.",
    );
    expect(findings.map((finding) => finding.message)).toContain(
      "Plan HTML artifacts must not reference remote assets: https://example.com/plan.css",
    );
  });

  it("accepts the older http-equiv charset form for existing artifacts", async () => {
    const rootDir = await createTempRepo();
    await writeFile(
      path.join(rootDir, "docs/plans/plan.html"),
      [
        "<!doctype html>",
        '<html lang="en">',
        "<head>",
        '  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">',
        "  <title>Plan</title>",
        "</head>",
        "<body><main><h1>Plan</h1></main></body>",
        "</html>",
      ].join("\n"),
    );

    await expect(
      collectPlanHtmlFindings(rootDir, ["docs/plans/plan.html"]),
    ).resolves.toEqual([]);
  });
});
