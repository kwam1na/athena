import type {
  HealthDigest,
  HealthPolicy,
  HealthSnapshot,
} from "./harness-validation-health";

/** Presentation only. Never consumed as health, approval or repair evidence. */
export function createHealthIncidentReport(
  digest: HealthDigest,
  policy: HealthPolicy,
  current: HealthSnapshot,
) {
  if (digest.repository !== policy.repository)
    throw new Error("Incident repository does not match protected policy");
  const runUrl = (runId: number, attempt?: number) =>
    `https://github.com/${policy.repository}/actions/runs/${runId}${attempt === undefined ? "" : `/attempts/${attempt}`}`;
  return {
    schemaVersion: "athena-health-incidents/1" as const,
    authority: "presentation-only" as const,
    owner: "Athena repository maintainer",
    triageBy: "next working day",
    runUrl: runUrl(digest.runId, digest.runAttempt),
    headSha: digest.headSha,
    inventoryComplete: digest.complete,
    incompleteChecks: digest.checks.filter(
      (check) =>
        check.outcome === "cancelled" || check.outcome === "unavailable",
    ),
    incidents: digest.findings
      .filter(
        (finding) =>
          !current.closedFindings.some(
            (closed) =>
              closed.finding.id === finding.id &&
              closed.finding.revision === finding.revision,
          ),
      )
      .map((finding) => ({
        finding: {
          ...finding,
          // Classification cannot silently localize an incident's declared scope.
          scope: structuredClone(
            policy.checks.find((check) => check.checkId === finding.checkId)
              ?.scope ?? { kind: "repo" as const },
          ),
        },
        runUrl: runUrl(finding.runId, finding.runAttempt),
        classification: "pending" as const,
      })),
  };
}

export function renderHealthIncidentReport(
  report: ReturnType<typeof createHealthIncidentReport>,
) {
  const escaped: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "`": "&#96;",
    "|": "&#124;",
    "\r": " ",
    "\n": " ",
  };
  const text = (value: string) =>
    value.replace(/[&<>`|\r\n]/g, (c) => escaped[c]);
  return [
    "## Validation health triage",
    "",
    `Owner: ${report.owner}. Triage by the ${report.triageBy}.`,
    `Run: ${report.runUrl}. Commit: ${report.headSha}.`,
    "",
    ...(report.inventoryComplete
      ? []
      : [
          "Full inventory is incomplete. Inspect the failed or unavailable steps; no successful inventory is claimed.",
          "",
        ]),
    ...report.incompleteChecks.map(
      (check) => `- ${text(check.checkId)}: ${check.outcome}.`,
    ),
    ...(report.incidents.length
      ? report.incidents.flatMap((incident) => [
          `- Finding: ${text(incident.finding.id)}; revision: ${text(incident.finding.revision)}.`,
          `  Check: ${text(incident.finding.checkId)}; commit: ${incident.finding.headSha}; declared scope: ${text(JSON.stringify(incident.finding.scope))}.`,
          `  Origin: ${incident.runUrl}. Classification: ${incident.classification}.`,
        ])
      : [
          "No open failed findings in this report; this statement does not close historical health findings.",
        ]),
    "",
    "Classify each failure as assertion, infrastructure or selection after inspecting its logs; record the repair owner and optional repair ticket/PR references on the linked run or tracker incident. Until then classification remains pending.",
    "For a selection miss, retain the open finding and add a regression fixture. Intersecting deliveries must use full-health before the next delivery; unrelated scopes may remain narrow. A passing repair candidate does not close global health.",
    "This report is presentation only. Narrowing or closure still requires the explicit protected-main maintainer approval and trusted main revalidation protocol; an edited report or candidate classification is not approval.",
    "",
  ].join("\n");
}
