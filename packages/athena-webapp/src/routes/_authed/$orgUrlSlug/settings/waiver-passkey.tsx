import { startRegistration } from "@simplewebauthn/browser";
import { createFileRoute } from "@tanstack/react-router";
import { useAction, useConvexAuth, useMutation } from "convex/react";
import { useState } from "react";

import { api } from "~/convex/_generated/api";
import { Button } from "@/components/ui/button";
import View from "@/components/View";

export const Route = createFileRoute("/_authed/$orgUrlSlug/settings/waiver-passkey")({
  component: WaiverPasskeySettings,
});

export function WaiverPasskeySettings() {
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const authorizeRegistration = useMutation(
    api.harnessWaiver.registrationAuthorization.authorizeRegistration,
  );
  const beginRegistration = useAction(api.harnessWaiver.passkeys.beginRegistration);
  const completeRegistration = useAction(api.harnessWaiver.passkeys.completeRegistration);
  const [bootstrapSecret, setBootstrapSecret] = useState("");
  const [status, setStatus] = useState<"idle" | "working" | "enrolled" | "error">("idle");

  async function enroll() {
    setStatus("working");
    try {
      const authorizationToken = crypto.randomUUID();
      const tokenHash = Array.from(new Uint8Array(await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(authorizationToken),
      )), (byte) => byte.toString(16).padStart(2, "0")).join("");
      await authorizeRegistration({ bootstrapSecret, tokenHash });
      const options = await beginRegistration({ authorizationToken });
      const response = await startRegistration({ optionsJSON: options });
      await completeRegistration({ challenge: options.challenge, response });
      setStatus("enrolled");
    } catch {
      setStatus("error");
    }
  }

  return (
    <View className="bg-background">
      <section className="mx-auto max-w-xl p-6">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">Delivery security</p>
        <h1 className="mt-3 text-2xl font-semibold">Waiver approval passkey</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Enroll the iPhone passkey used to approve candidate-bound documentation waivers. Athena accepts one reviewer credential and does not provide an agent-accessible fallback.
        </p>
        <div className="mt-6">
          {isAuthLoading ? (
            <p className="text-sm text-muted-foreground">Confirming your Athena session…</p>
          ) : !isAuthenticated ? (
            <div className="grid gap-3 text-sm">
              <p className="text-destructive">Your Athena session is not available for passkey enrollment.</p>
              <a className="font-medium text-primary underline underline-offset-4" href="/login">
                Sign in again
              </a>
            </div>
          ) : status === "enrolled" ? (
            <p className="text-sm font-medium text-emerald-700">Passkey enrolled.</p>
          ) : (
            <div className="grid gap-3">
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">One-time enrollment secret</span>
                <input
                  className="rounded-md border bg-background px-3 py-2"
                  type="password"
                  autoComplete="off"
                  value={bootstrapSecret}
                  onChange={(event) => setBootstrapSecret(event.target.value)}
                />
              </label>
              <Button disabled={status === "working" || !bootstrapSecret} onClick={() => void enroll()}>
                {status === "working" ? "Waiting for iPhone…" : "Enroll iPhone passkey"}
              </Button>
            </div>
          )}
          {status === "error" ? <p className="mt-3 text-sm text-destructive">Passkey enrollment was not completed.</p> : null}
        </div>
      </section>
    </View>
  );
}
