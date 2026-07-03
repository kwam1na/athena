---
title: Athena Login OTP Auth Sync Handoff Waits For App User Sync
date: 2026-07-03
category: logic-errors
module: athena-webapp
problem_type: logic_error
component: authentication
symptoms:
  - "OTP login can redirect back to /login after a valid server-generated code"
  - "Reloading /login after the bounce can enter the authenticated app"
  - "POS recovery login can share the same redirect race when it navigates before app-user sync"
root_cause: async_timing
resolution_type: code_fix
severity: high
related_components:
  - "convex-auth"
  - "tanstack-router"
  - "pos-recovery-login"
tags:
  - auth-sync
  - otp-login
  - convex-auth
  - session-storage
  - pos-recovery
---

# Athena Login OTP Auth Sync Handoff Waits For App User Sync

## Problem

Athena has two auth states after OTP success: Convex Auth knows the browser is
signed in, and Athena still needs `syncAuthenticatedAthenaUser` to create or
load the application user, persist the local app-user id, and then send the
operator into the authenticated app. If the OTP form navigates immediately
after `signIn`, route guards can observe the gap between those states and send
the browser back to `/login`.

## Symptoms

- A valid server-generated OTP returns the user to `/login`.
- Manually reloading `/login` finishes the authenticated redirect because
  Convex Auth has settled by then.
- POS recovery-code login can regress the same way if it navigates to the POS
  redirect before the Athena app-user sync is complete.

## What Didn't Work

- Navigating from `InputOTPForm` or `PosRecoveryCodeForm` immediately after
  provider success. That moved the browser before the login layout had durable
  app-user evidence.
- Using a bare session-storage sentinel such as `"1"`. It could keep the UI in
  a pending state without a bounded lifetime or a trusted redirect payload.
- Treating stale locally persisted app-user ids as enough authority while a new
  auth-sync handoff is pending. That can let the authed shell make POS recovery
  decisions from stale account evidence.

## Solution

Keep the OTP and POS recovery forms responsible only for starting an auth-sync
handoff. The login layout owns the durable completion step:

1. Store bounded handoff metadata in session storage:
   `redirectTo` and `startedAt`.
2. Let `LoginLayout` wait until Convex Auth is authenticated and an auth token
   exists.
3. Run `syncAuthenticatedAthenaUser`.
4. Clear the handoff, persist `LOGGED_IN_USER_ID_KEY` and
   `POS_APP_ACCOUNT_ID_KEY`, then navigate to the stored safe redirect.

The forms should not call `navigate` after successful `signIn`:

```ts
const result = await signIn(ATHENA_EMAIL_OTP_PROVIDER_ID, {
  code: data.pin,
  email: email.trim().toLowerCase(),
});

if (result.signingIn) {
  startAthenaAuthSyncHandoff();
  setIsAuthHandoffPending(true);
}
```

The handoff reader should fail closed on missing, invalid, or expired metadata:

```ts
const handoffStatus = getAthenaAuthSyncHandoffStatus();

if (handoffStatus.kind === "expired" || handoffStatus.kind === "invalid") {
  failAthenaAuthSyncHandoff();
  return;
}
```

`useAuth` should also treat a fresh pending handoff as loading. That prevents
the authenticated shell from clearing or trusting stale local user ids while
Convex Auth and Athena app-user sync are converging.

## Why This Works

The user-visible redirect now happens only after the same component that owns
`syncAuthenticatedAthenaUser` has durable evidence that Athena has an app user
for the Convex Auth session. The handoff metadata lets POS recovery preserve its
intended route, but the redirect is still delayed until the app-user sync
finishes. The TTL keeps a failed or tampered handoff from pinning the login UI
forever.

## Prevention

- Keep provider forms side-effect-light: they may start the handoff, but they
  should not navigate to authenticated routes.
- Include a TTL and normalized same-origin path in any client-side auth handoff
  metadata. Do not store OTPs, auth tokens, or raw backend errors there.
- Add tests that prove valid OTP and POS recovery sign-in do not navigate from
  the form, stale handoff metadata clears, and stored POS redirects with query
  params are used only after app-user sync succeeds.
- Add an authed-route regression proving pending auth-sync loading is not
  treated as POS terminal authority or a ready app user.
- Prove the behavior in a browser with repeated real OTP cycles, because this
  class of bug depends on auth-provider timing, router redirects, and local
  storage state.

## Related Issues

- [Athena POS Recovery-Code Login Keeps App Account And Staff Authority Separate](../architecture/athena-pos-recovery-code-login-2026-06-03.md)
- Linear V26-940: Stabilize login OTP auth-sync handoff
