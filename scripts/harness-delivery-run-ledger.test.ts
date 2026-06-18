import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildPartialDeliveryRunBaseline,
  createDeliveryRunLedger,
  readDeliveryRunBaseline,
  writeDeliveryRunLedger,
} from "./harness-delivery-run-ledger";

const tempRoots: string[] = [];

async function createTempRoot() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "athena-delivery-run-ledger-"));
  tempRoots.push(rootDir);
  return rootDir;
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((rootDir) =>
      rm(rootDir, { recursive: true, force: true })
    )
  );
});

describe("delivery run ledger", () => {
  it("summarizes command spans, duplicate commands, package-suite duplicates, provider skips, and proof state", async () => {
    const ledger = createDeliveryRunLedger({
      generatedAt: "2026-06-18T12:00:00.000Z",
      status: "pass",
      proofState: "proof_recorded",
      commandSpans: [
        {
          phase: "prepare",
          command: "bun run pr:athena:prepare",
          startedAt: "2026-06-18T12:00:00.000Z",
          endedAt: "2026-06-18T12:00:02.000Z",
          durationMs: 2000,
          status: "pass",
          exitCode: 0,
        },
        {
          phase: "validate",
          command: "bun run --filter '@athena/webapp' test:coverage",
          startedAt: "2026-06-18T12:00:02.000Z",
          endedAt: "2026-06-18T12:00:07.000Z",
          durationMs: 5000,
          status: "pass",
          exitCode: 0,
          packageName: "@athena/webapp",
          suite: "test:coverage",
        },
        {
          phase: "validate",
          command: "bun run --filter '@athena/webapp' test:coverage",
          startedAt: "2026-06-18T12:00:08.000Z",
          endedAt: "2026-06-18T12:00:13.000Z",
          durationMs: 5000,
          status: "pass",
          exitCode: 0,
          packageName: "@athena/webapp",
          suite: "test:coverage",
        },
        {
          phase: "record-proof",
          command: "bun run pr:athena:record-proof",
          startedAt: "2026-06-18T12:00:13.000Z",
          endedAt: "2026-06-18T12:00:14.000Z",
          durationMs: 1000,
          status: "pass",
          exitCode: 0,
        },
      ],
      providerSkippedEvents: [
        {
          providerName: "pre-push:review",
          coveredBy: "pr:athena",
          reason: "pr:athena already supplied repo validation",
        },
      ],
    });

    expect(ledger).toMatchObject({
      version: "1.0",
      status: "pass",
      proofState: "proof_recorded",
      summary: {
        commandCount: 4,
        failedCommandCount: 0,
        duplicateCommandCount: 1,
        duplicatePackageSuiteCount: 1,
        providerSkippedCount: 1,
      },
      duplicateCommands: [
        {
          command: "bun run --filter '@athena/webapp' test:coverage",
          count: 2,
        },
      ],
      duplicatePackageSuites: [
        {
          packageName: "@athena/webapp",
          suite: "test:coverage",
          count: 2,
        },
      ],
      providerSkippedEvents: [
        {
          providerName: "pre-push:review",
          status: "covered_by_provider",
          coveredBy: "pr:athena",
        },
      ],
    });
  });

  it("writes latest, optional history, and optional baseline artifacts under ignored delivery-run paths", async () => {
    const rootDir = await createTempRoot();
    const ledger = createDeliveryRunLedger({
      generatedAt: "2026-06-18T12:00:00.000Z",
      status: "blocked",
      proofState: "proof_not_recorded",
      commandSpans: [],
      blockedReason: "prepare failed before validation",
    });

    const result = await writeDeliveryRunLedger(rootDir, ledger, {
      historyPath: "artifacts/harness-delivery-runs/history/manual.json",
      baselinePath: "artifacts/harness-delivery-runs/baseline.json",
    });

    expect(result.latestPath).toBe("artifacts/harness-delivery-runs/latest.json");
    expect(JSON.parse(await readFile(path.join(rootDir, result.latestPath), "utf8"))).toMatchObject({
      status: "blocked",
      blockedReason: "prepare failed before validation",
    });
    expect(JSON.parse(await readFile(path.join(rootDir, result.historyPath!), "utf8"))).toMatchObject({
      status: "blocked",
    });
    expect(await readDeliveryRunBaseline(rootDir)).toMatchObject({
      status: "blocked",
      proofState: "proof_not_recorded",
    });
  });

  it("builds partial baselines that tolerate missing prior artifacts", async () => {
    const rootDir = await createTempRoot();

    await expect(readDeliveryRunBaseline(rootDir)).resolves.toBeNull();
    await expect(buildPartialDeliveryRunBaseline(rootDir)).resolves.toMatchObject({
      present: false,
      status: "missing",
      commandCount: 0,
      duplicateCommandCount: 0,
      duplicatePackageSuiteCount: 0,
    });
  });
});
