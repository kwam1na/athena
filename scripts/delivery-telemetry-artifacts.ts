/** Data-only source integrity; deliberately independent of Athena config and run journals. */
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseRunExport } from "../.agent-skills/current/runtime/cli-api.mjs";
import { parseDeliveryRecord } from "../.agent-skills/current/runtime/kernel.mjs";
import { collectChangedPathsForDiff } from "./delivery-diff-fingerprint";
type TelemetryArtifactFinding = {
  code: "telemetry_record_malformed";
  message: string;
};

// Use Athena's data-only CLI envelope, as the selection guard does. Importing
// harness-blockers here would eagerly execute candidate harness.config.ts.
function artifactBlocker(value: {
  code: string;
  source: { kind: "command"; id: string };
  summary: string;
  details?: string;
  remediations: Array<{ id: string; kind: "manual_action"; summary: string }>;
}) {
  return value;
}
class TelemetryArtifactError extends Error {
  constructor(
    readonly blockers: ReturnType<typeof artifactBlocker>[],
    message = "Telemetry artifact check refused",
  ) {
    super(message);
  }
}

const isTelemetryRecordPath = (file: string) =>
  file.startsWith("telemetry/delivery-runs/") && file.endsWith(".json");
export function collectDeliveryRunTelemetryArtifactFindings(
  changedPaths: string[],
  contents: Map<string, unknown>,
): TelemetryArtifactFinding[] {
  const findings: TelemetryArtifactFinding[] = [];
  for (const recordPath of changedPaths.filter(isTelemetryRecordPath)) {
    if (!contents.has(recordPath)) continue; // Deleted source artifact.
    const text = JSON.stringify(contents.get(recordPath)) ?? "null";
    if (!parseRunExport(text).ok && !parseDeliveryRecord(text).ok) {
      findings.push({
        code: "telemetry_record_malformed",
        message: `Changed telemetry artifact ${recordPath} is not a valid product run export or delivery record. Regenerate it using the installed product.`,
      });
    }
  }
  return findings;
}

/** Source-artifact integrity only. No current-run lookup, candidate policy load,
 * gate freshness claim, or requirement that this delivery has already exported. */
export async function evaluateDeliveryRunTelemetryArtifacts(
  rootDir: string,
  options: { baseRef: string },
) {
  if (!options.baseRef.trim())
    throw new Error("Artifact integrity requires an explicit base");
  const changedPaths = collectChangedPathsForDiff(rootDir, options.baseRef);
  const changedRecordContents = new Map<string, unknown>();
  for (const recordPath of changedPaths.filter(isTelemetryRecordPath)) {
    const absolute = path.join(rootDir, recordPath);
    try {
      const stat = lstatSync(absolute);
      if (!stat.isFile()) {
        changedRecordContents.set(recordPath, null);
        continue;
      }
      changedRecordContents.set(
        recordPath,
        JSON.parse(readFileSync(absolute, "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        changedRecordContents.set(recordPath, null);
    }
  }
  const findings = collectDeliveryRunTelemetryArtifactFindings(
    changedPaths,
    changedRecordContents,
  );
  return {
    status: findings.length ? ("fail" as const) : ("pass" as const),
    findings,
  };
}

export async function assertDeliveryRunTelemetryArtifacts(
  rootDir: string,
  options: { baseRef: string },
) {
  const result = await evaluateDeliveryRunTelemetryArtifacts(rootDir, options);
  if (result.status === "pass") return;
  throw new TelemetryArtifactError(
    result.findings.map((finding) =>
      artifactBlocker({
        code: finding.code,
        source: { kind: "command", id: "delivery:telemetry-artifacts-check" },
        summary: finding.message,
        remediations: [
          {
            id: "repair-telemetry-artifact",
            kind: "manual_action",
            summary:
              "Restore or regenerate the malformed source artifact using the installed product; artifact integrity does not establish current-run completion.",
          },
        ],
      }),
    ),
    "Delivery telemetry artifact integrity failed.",
  );
}

export function parseTelemetryArtifactArgs(args: string[]): {
  baseRef: string;
} {
  if (
    args.length !== 2 ||
    args[0] !== "--base" ||
    !args[1].trim() ||
    args[1].startsWith("-")
  ) {
    throw new TelemetryArtifactError([
      artifactBlocker({
        code: "telemetry_artifact_usage",
        source: { kind: "command", id: "delivery:telemetry-artifacts-check" },
        summary:
          "Usage: bun scripts/delivery-telemetry-artifacts.ts --base <ref>",
        remediations: [
          {
            id: "supply-explicit-base",
            kind: "manual_action",
            summary:
              "Supply the declared base ref; isolated checks use refs/delivery/base.",
          },
        ],
      }),
    ]);
  }
  return { baseRef: args[1] };
}

if (import.meta.main) {
  try {
    await assertDeliveryRunTelemetryArtifacts(
      process.cwd(),
      parseTelemetryArtifactArgs(process.argv.slice(2)),
    );
    console.log(
      "Delivery telemetry source artifact integrity passed; current-run admission not evaluated.",
    );
  } catch (error) {
    const blockers =
      error instanceof TelemetryArtifactError
        ? error.blockers
        : [
            artifactBlocker({
              code: "telemetry_artifact_read_failed",
              source: {
                kind: "command",
                id: "delivery:telemetry-artifacts-check",
              },
              summary:
                "Cannot inspect source telemetry artifacts against the declared base.",
              details: error instanceof Error ? error.message : String(error),
              remediations: [
                {
                  id: "inspect-artifact-base",
                  kind: "manual_action",
                  summary:
                    "Check that the declared base exists and source artifacts are readable, then rerun.",
                },
              ],
            }),
          ];
    console.error(JSON.stringify({ schemaVersion: 1, blockers }));
    process.exitCode = 1;
  }
}
