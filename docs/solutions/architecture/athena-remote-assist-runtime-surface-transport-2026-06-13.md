---
title: "Athena Remote Assist Runtime Surface Transport"
date: 2026-06-13
category: architecture
module: athena-webapp
problem_type: remote_support_runtime_handoff
component: remote-assist
resolution_type: provider_neutral_live_session_transport
severity: high
tags:
  - remote-assist
  - pos
  - livekit
  - runtime
---

# Athena Remote Assist Runtime Surface Transport

## Problem

Remote Assist needs to support unattended help across Athena store workspaces,
not only the POS register route. A terminal can start on the POS hub, move into
cash controls, operations, transactions, or another store workspace, and still
need support to understand where the runtime is and send safe actions.

The first session foundation only persisted orchestration state. That proved the
handoff, but support still needed a provider-backed runtime transport, reliable
route ownership, deterministic control targets, action feedback, and runtime
version evidence before the flow could be treated as a live support tool.

## Solution

Keep orchestration provider-neutral and put the live transport behind the Remote
Assist transport adapter:

- Runtime and support request scoped credentials through Convex and connect to
  the configured provider through the adapter boundary.
- The runtime publishes sanitized co-browse frames on a short interval. Frames
  include route, viewport, sensitive-region metadata, visible text snippets, and
  deterministic `data-remote-assist-*` control targets.
- Support sends control intents back over the same transport. The runtime
  validates sensitive regions and viewport bounds before applying the action and
  publishes an accepted or rejected result for the support console.
- The runtime host mounts at the authenticated store workspace layer, not inside
  one POS route, so Remote Assist survives navigation between POS and adjacent
  store workspaces.
- Base navigation components expose remote-assistable controls so page headers,
  sidebars, and POS surfaces can participate without each page hand-coding the
  same instrumentation.
- The support console groups controls by current surface, header, and app
  navigation. It favors the currently selected route surface and uses the route
  rather than stale document title to name the active workspace.
- Terminal check-in reports Athena webapp build metadata from `/deploy.json`
  when deployed, with a local `dev` fallback, so support can see which static app
  version the host runtime is executing.

This is still a structured co-browse/control transport, not a full pixel stream.
Actual screen viewing requires a later provider-backed visual channel, such as a
redacted screenshot stream or media track, layered onto the same adapter.

## Boundaries

Do not couple session orchestration directly to LiveKit APIs. LiveKit can be the
configured provider, but Athena code outside the provider implementation should
continue to speak Remote Assist transport concepts: credentials, runtime frames,
runtime state, control intents, and control results.

Do not treat sanitized text/control frames as a real host screen. The support
console can show route, surface controls, and action feedback from those frames,
but any promise of "viewing the host screen" needs an explicit visual transport.

Do not mount the runtime only under POS register or terminal routes. Remote
Assist should follow the authenticated store workspace shell whenever the local
terminal seed is available.

## Prevention

- Keep provider-specific code inside the transport provider/client adapter.
- Add route-shape regression tests whenever the runtime host moves up or new
  store workspace routes become remote-assistable.
- Prefer base component instrumentation for common app controls instead of
  page-by-page annotations.
- Keep sensitive inputs marked with `data-remote-assist-sensitive` or existing
  sensitive selectors so both frames and control validation mask or reject them.
- Test the transport at three layers: contract serialization, provider client
  behavior, and runtime/support React flows.
- Run browser validation against an active Remote Assist session before claiming
  an end-to-end support workflow is delivered.
