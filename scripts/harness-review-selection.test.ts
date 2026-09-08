import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { importHarnessConfig } from "../.agent-skills/current/runtime/cli-api.mjs";
import { parseReviewOutcome, resolveReviewCharters } from "../.agent-skills/current/runtime/kernel.mjs";
import selection from "../.agents/review-selection.json";

const rootDir = path.resolve(import.meta.dir, "..");
const fixtures: string[] = [];
afterEach(async () => { await Promise.all(fixtures.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

async function loadSelection(value: unknown) {
  const dir = await mkdtemp(path.join(tmpdir(), "athena-review-selection-"));
  fixtures.push(dir);
  const source = (await readFile(path.join(rootDir, "harness.config.ts"), "utf8"))
    .replaceAll('from "./', `from "${rootDir}/`)
    .replace(`${rootDir}/.agents/review-selection.json`, `${dir}/selection.json`);
  await writeFile(path.join(dir, "harness.config.ts"), source);
  await writeFile(path.join(dir, "selection.json"), JSON.stringify(value));
  return importHarnessConfig(dir);
}
const readRepository = async (relativePath: string) => {
  try { return await readFile(path.join(rootDir, relativePath)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
};

// The selection file is the whole additional roster: an ordinary Athena
// delivery lists the always-on reviewers in it alongside its conditionals.
const ORDINARY_SELECTION = [
  "ce-correctness-reviewer",
  "ce-testing-reviewer",
  "ce-maintainability-reviewer",
  "ce-project-standards-reviewer",
  "ce-agent-native-reviewer",
  "ce-learnings-researcher",
  "ce-security-reviewer",
].map(reviewerId => ({ reviewerId, reason: "ordinary Athena selection" }));

it("binds exactly the selected charters alongside the two installed defaults", async () => {
  const config = await loadSelection(ORDINARY_SELECTION);
  const charters = await resolveReviewCharters(readRepository, config);
  expect(charters.filter(charter => charter.origin === "composition")).toHaveLength(2);
  expect(charters.filter(charter => charter.origin === "repository")).toHaveLength(ORDINARY_SELECTION.length);
  expect(new Set(charters.map(charter => charter.reviewerId)).size).toBe(charters.length);
  expect(config.preparationWiringPaths).toContain(".agents/review-selection.json");
  expect(charters.every(charter => /^[a-f0-9]{64}$/.test(charter.digest))).toBe(true);
});

it("adds no reviewer the selection file does not name", async () => {
  const config = await loadSelection(selection);
  const charters = await resolveReviewCharters(readRepository, config);
  expect(charters.filter(charter => charter.origin === "repository").map(charter => charter.reviewerId))
    .toEqual(selection.map(entry => entry.reviewerId));
});

// An empty selection is a deliberate choice to review under the product's two
// mandated lenses alone, so nothing may be reinstated behind it.
it("reduces an empty selection to the two installed default lenses", async () => {
  const charters = await resolveReviewCharters(readRepository, await loadSelection([]));
  expect(charters).toHaveLength(2);
  expect(charters.every(charter => charter.origin === "composition")).toBe(true);
});

it.each([
  [{ reviewerId: "ce-security-reviewer", reason: "" }],
  [{ reviewerId: "ce-security-reviewer", reason: "selected", extra: true }],
  [{ reviewerId: 7, reason: "selected" }],
  [null],
].map(value => ({ value })))("rejects malformed selection data $value through config loading", async ({ value }) => {
  await expect(loadSelection(value)).rejects.toThrow();
});

it("uses product validation to reject a reviewer id selected twice", async () => {
  const entry = { reviewerId: "ce-testing-reviewer", reason: "selected twice" };
  await expect(loadSelection([entry, entry])).rejects.toThrow();
});

it("refuses an unknown reviewer whose repository charter does not exist", async () => {
  const config = await loadSelection([{ reviewerId: "ce-unknown-reviewer", reason: "unknown" }]);
  await expect(resolveReviewCharters(readRepository, config)).rejects.toThrow("missing or empty");
});

it("requires the exact selected reviewer coverage at the product outcome boundary", async () => {
  const charters = await resolveReviewCharters(readRepository, await loadSelection(ORDINARY_SELECTION));
  const ids = charters.map(charter => charter.reviewerId);
  const outcome = { spec: "review-outcome/1", verdict: "green", findings: [], reviewers: ids.map(id => ({ id, result: "approved" })) };
  expect(parseReviewOutcome(outcome, ids).reviewers).toHaveLength(ids.length);
  expect(() => parseReviewOutcome({ ...outcome, reviewers: outcome.reviewers.slice(1) }, ids)).toThrow("unrepresented");
  expect(() => parseReviewOutcome({ ...outcome, reviewers: [...outcome.reviewers, { id: "ce-unknown-reviewer", result: "approved" }] }, ids)).toThrow("no activated review lens defines");
});
