import { startAuthentication } from "@simplewebauthn/browser";
import { createFileRoute } from "@tanstack/react-router";
import { useAction } from "convex/react";
import { useEffect, useState } from "react";

import { api } from "~/convex/_generated/api";
import { Button } from "@/components/ui/button";

type WaiverCandidate = {
  repository: string;
  prNumber: number;
  headSha: string;
  baseRef: string;
  baseSha: string;
  diffBaseSha: string;
  deliverableTreeSha: string;
  identityVersion: string;
  waivedFindingCodes: string[];
  reason: string;
};

export const Route = createFileRoute("/waiver/approve")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : "",
  }),
  component: WaiverApprovalPage,
});

function WaiverApprovalPage() {
  const { token } = Route.useSearch();
  const getOptions = useAction(api.harnessWaiver.passkeys.getApprovalOptions);
  const completeApproval = useAction(api.harnessWaiver.passkeys.completeApproval);
  const [request, setRequest] = useState<Awaited<ReturnType<typeof getOptions>>>();
  const [status, setStatus] = useState<"loading" | "ready" | "approving" | "approved" | "error">("loading");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      return;
    }
    void getOptions({ token })
      .then((value) => {
        setRequest(value);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, [getOptions, token]);

  async function approve() {
    if (!request || !token) return;
    setStatus("approving");
    try {
      const response = await startAuthentication({ optionsJSON: request.options });
      await completeApproval({ token, response });
      setStatus("approved");
    } catch {
      setStatus("error");
    }
  }

  return (
    <main className="min-h-screen bg-background px-5 py-12 text-foreground">
      <section className="mx-auto max-w-xl rounded-2xl border bg-card p-6 shadow-sm">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
          Athena delivery control
        </p>
        <h1 className="mt-3 text-2xl font-semibold">Documentation waiver approval</h1>
        {request ? <WaiverCandidateDetails candidate={request.candidate} /> : null}
        <p className="mt-5 text-sm text-muted-foreground">
          Face ID confirms this exact candidate. The approval expires after fifteen minutes and cannot be reused.
        </p>
        <div className="mt-6">
          {status === "approved" ? (
            <p className="text-sm font-medium text-emerald-700">Approved. You can close this page.</p>
          ) : status === "error" ? (
            <p className="text-sm font-medium text-destructive">This approval request is unavailable or was not completed.</p>
          ) : (
            <Button disabled={approvalControlDisabled(status, Boolean(request))} onClick={() => void approve()}>
              {status === "approving" ? "Waiting for Face ID…" : "Approve with passkey"}
            </Button>
          )}
        </div>
      </section>
    </main>
  );
}

export function approvalControlDisabled(status: string, hasRequest: boolean) {
  return status !== "ready" || !hasRequest;
}

export function WaiverCandidateDetails({ candidate }: { candidate: WaiverCandidate }) {
  return (
    <dl className="mt-6 grid gap-3 rounded-xl border bg-muted/30 p-4 text-sm">
      <div><dt className="text-muted-foreground">Repository</dt><dd>{candidate.repository}</dd></div>
      <div><dt className="text-muted-foreground">Pull request</dt><dd>#{candidate.prNumber}</dd></div>
      <div><dt className="text-muted-foreground">Head commit</dt><dd className="break-all font-mono text-xs">{candidate.headSha}</dd></div>
      <div><dt className="text-muted-foreground">Base ref</dt><dd className="font-mono text-xs">{candidate.baseRef}</dd></div>
      <div><dt className="text-muted-foreground">Base commit</dt><dd className="break-all font-mono text-xs">{candidate.baseSha}</dd></div>
      <div><dt className="text-muted-foreground">Merge base</dt><dd className="break-all font-mono text-xs">{candidate.diffBaseSha}</dd></div>
      <div><dt className="text-muted-foreground">Deliverable tree</dt><dd className="break-all font-mono text-xs">{candidate.deliverableTreeSha}</dd></div>
      <div><dt className="text-muted-foreground">Identity version</dt><dd className="font-mono text-xs">{candidate.identityVersion}</dd></div>
      <div><dt className="text-muted-foreground">Waived obligations</dt><dd>{candidate.waivedFindingCodes.join(", ")}</dd></div>
      <div><dt className="text-muted-foreground">Reason</dt><dd>{candidate.reason}</dd></div>
    </dl>
  );
}
