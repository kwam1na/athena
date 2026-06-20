---
title: Athena App-Wide Messaging Uses Adapter-Owned Actions
date: 2026-06-20
category: architecture
module: athena-webapp
problem_type: app_wide_message_action_foundation
component: app-messages
symptoms:
  - "Update Ready behavior had reusable message placement and action-blocker mechanics packaged as app-update concepts"
  - "POS and Inventory Import needed to block app update apply without making app update the platform abstraction"
  - "Remote terminal update evidence needed to stay app-update-specific rather than becoming a generic message command"
root_cause: reusable_action_message_mechanics_were_owned_by_the_first_app_update_use_case
resolution_type: app_message_foundation_with_app_update_adapter
severity: medium
tags:
  - app-messages
  - app-update
  - platform-foundation
  - pos
  - inventory-import
---

# Athena App-Wide Messaging Uses Adapter-Owned Actions

## Problem

Athena's Update Ready work introduced a useful pattern: a persistent app-wide
message, an operator action, and surface-owned blockers that can defer that
action until local work is safe. Those mechanics are broader than app updates.
If they remain named and owned by `app-update`, future app-wide messages will
either couple to update semantics or duplicate the same blocker and placement
logic.

The first implementation still matters. App update has domain-specific
responsibilities that should not move into a generic foundation: version
detection, static asset staging, pending-build cross-tab leases, reload latching,
remote terminal runtime evidence, and `update_app` command handling.

## Boundary

- `src/lib/app-messages` owns browser-local message/action mechanics: message
  registration, action ids, selected blocker resolution, blocker priority
  sorting, banner/toast placement preference, and compatibility-safe provider
  state.
- `src/components/app-messages/AppMessageHost.tsx` renders the selected generic
  message and resolves blockers by the message action's `actionId` before
  exposing an action button.
- Adapters own domain state, action execution, telemetry, and copy. They publish
  a message/action snapshot into app messages; app messages do not execute
  domain work by itself.
- Surfaces own opt-in truth. POS and Inventory Import decide when their work
  blocks `app-update.apply`; app messages only stores the resulting blocker
  snapshot.
- `src/lib/app-update` remains the app-update adapter. It owns update detection,
  asset staging, cross-tab pending-build scoping, runtime status evidence, and
  reload apply through the coordinator.
- Remote terminal `update_app` remains an app-update intent routed through the
  update coordinator after acknowledgement. App messages must not become a
  remote command platform or blind reload path.

## Solution

Mount `AppMessagesProvider` above `UpdateCoordinatorProvider` in the app root so
the app-update adapter can project app-message blockers into the update
coordinator. The projection is one-way for first-party surfaces:

1. POS and Inventory Import call `useAppActionBlocker` with
   `actionId: "app-update.apply"`.
2. `UpdateCoordinatorProvider` reads app-message blockers for that action id and
   syncs them into the update coordinator as local apply blockers.
3. The update coordinator keeps pending-build-scoped cross-tab leasing and the
   single reload latch.
4. `UpdateReadyBanner` acts as the app-update message adapter: it computes the
   update message/action from the coordinator and registers it with
   `useAppMessage`.
5. `AppMessageHost` renders that message through the generic banner/toast
   placement and suppresses the action when an app-message blocker exists for
   the action id.

Compatibility exports can remain in `src/lib/app-update`, but they should bridge
to the foundation without breaking older provider arrangements. In particular,
`UpdateCommunicationPreferenceProvider` must not shadow an existing
`AppMessagesProvider`, and `useUpdateApplyBlocker` must continue to register
with `UpdateCoordinatorProvider` when an older test or caller uses the legacy
hook without app messages mounted.

## Regression Targets

Run these focused checks when changing the foundation, the app-update adapter,
or first-party blockers:

- `src/lib/app-messages/useAppActionBlocker.test.tsx`
- `src/components/app-messages/AppMessageHost.test.tsx`
- `src/lib/app-update/updateCoordinator.test.ts`
- `src/components/app-update/UpdateReadyBanner.test.tsx`
- `src/components/pos/register/POSRegisterView.test.tsx`
- `src/components/operations/InventoryImportView.test.tsx`
- `src/lib/pos/presentation/register/useRegisterLocalRuntime.test.ts`
- `src/components/remote-assist/PosRemoteAssistRuntimeHost.test.tsx`
- `src/lib/pos/infrastructure/local/terminalRecoveryCommands.test.ts`
- `src/lib/pos/infrastructure/local/usePosLocalSyncRuntime.test.ts`

Also run `bun run graphify:rebuild` after code changes so Graphify reflects the
new foundation and adapter edge.

## Prevention

- Do not put app-update names, toast ids, pending-build semantics, or reload
  policy into `app-messages`.
- Do not let app messages execute domain actions by name. The adapter supplies
  the action callback and remains responsible for domain side effects.
- Do not move POS, Inventory Import, Terminal Health, or Remote Assist truth into
  app messages. They should publish snapshots into the foundation.
- Do not introduce a generic scheduler, persistence layer, command bus, or
  remote-control surface as part of app-wide messaging.
- Keep compatibility wrappers from creating nested providers that hide
  registrations from the root app-message host.
- Preserve calm, operational copy at the adapter/surface boundary.

## Related

- [Athena App Updates Use Operator-Applied Refresh With Opt-In Blockers](./athena-app-update-apply-safety-2026-06-17.md)
- [Athena Remote Assist Is A Generic Browser-Client Foundation](./athena-remote-assist-foundation-2026-06-11.md)
- [Athena POS Terminal Recovery Readiness Boundary](./athena-pos-terminal-recovery-readiness-boundary-2026-06-14.md)
