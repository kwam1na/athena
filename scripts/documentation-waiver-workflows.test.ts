import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = path.resolve(import.meta.dirname, "..");

async function workflow(name: string) {
  return readFile(path.join(rootDir, ".github/workflows", name), "utf8");
}

describe("documentation waiver workflow trust chain", () => {
  it("keeps Actions write permission inside the immutable request relay", async () => {
    const request = await workflow("athena-documentation-waiver-request.yml");
    const issuer = await workflow("athena-documentation-waiver.yml");

    expect(request).toContain("actions: write");
    expect(request).toContain("actions/upload-artifact@v4");
    expect(request).toContain("Create iPhone passkey approval request");
    expect(request).toContain("ATHENA_WAIVER_BROKER_SECRET");
    expect(request).toContain("Passkey approval timed out");
    expect(request).toContain("Create iPhone passkey approval request");
    expect(request).toContain("Wait for iPhone passkey approval");
    expect(request.indexOf("GITHUB_STEP_SUMMARY")).toBeLessThan(
      request.indexOf("Wait for iPhone passkey approval"),
    );
    expect(request).toContain("relay_run_id: String(context.runId)");
    expect(request).toContain("group: documentation-waiver-request-${{ inputs.head_sha }}");
    expect(issuer).toContain("group: documentation-waiver-issuer-${{ inputs.head_sha }}");
    expect(issuer).toContain("cancel-in-progress: true");
    expect(issuer).not.toContain("actions: write");
    expect(issuer).toContain("checks: write");
  });

  it("binds the protected issuer to the relay artifact and exact workflow run", async () => {
    const issuer = await workflow("athena-documentation-waiver.yml");

    expect(issuer).toContain("environment: athena-documentation-waiver");
    expect(issuer).toContain("actions/download-artifact@v4");
    expect(issuer).toContain("Consume verified iPhone passkey approval");
    expect(issuer).toContain("The consumed passkey approval does not match the verified candidate");
    expect(issuer).toContain(
      'relayRun.path !== ".github/workflows/athena-documentation-waiver-request.yml"',
    );
    expect(issuer).toContain('workflowRun.actor?.login !== trustedRequester');
    expect(issuer).toContain("relayWorkflowRunId: relayRunId");
    expect(issuer.indexOf("Verify relay and protected-environment approval")).toBeLessThan(
      issuer.indexOf("Consume verified iPhone passkey approval"),
    );
  });
});
