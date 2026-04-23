# Client Server Error Foundation Design

## Summary

Athena needs a stable app-wide foundation for handling server failures on the client without leaking backend internals, transport details, or stack-like diagnostics. The current behavior mixes raw thrown exceptions, ad hoc toast copy, and default framework error rendering. This design replaces that with a result-first command contract, a narrow user-safe error envelope, and a clear separation between server semantics and client presentation.

The core decision is that expected business failures are data, not exceptions. User-initiated write operations return either a successful payload or a user-safe error object. Truly unexpected faults continue to throw, but the client never shows thrown server text to users.

## Problem

Today, client surfaces can expose raw Convex and server error text directly in toasts, dialogs, and route boundaries. This creates several risks:

- Internal implementation details leak into the UI.
- User experience is inconsistent across forms, modals, and quick actions.
- Components make their own decisions about which server text is safe.
- Expected business failures and unexpected faults are conflated.
- Global boundaries act as the first line of defense instead of the last.

This makes the app harder to reason about, harder to test, and less resilient when new server operations are added.

## Goals

- Establish one stable error-handling model for all user-initiated write operations.
- Prevent unexpected server and transport text from ever reaching user-facing UI.
- Preserve specific, actionable business feedback when the server intentionally provides it.
- Standardize where failures appear: inline for surfaces with a durable home, toast otherwise.
- Keep route and render boundaries as safe generic backstops.
- Make the model easy to test and easy to extend without reintroducing ad hoc error handling.

## Non-Goals

- Refactor every existing feature in one pass.
- Design a full observability pipeline or support workflow.
- Solve localization in this first iteration.
- Replace all query/read-state patterns immediately.

## Design Principles

The foundation follows these first-principles rules:

1. Expected failure is data.
2. Unexpected failure is a fault.
3. The server decides semantics.
4. The client decides presentation.
5. Raw exception text is never user copy.
6. Global boundaries catch escapes; they do not define normal UX.

## Core Model

Every user-initiated write operation is modeled as a command. A command returns one of two expected outcomes:

- `ok`: the operation completed successfully and may return data.
- `user_error`: the operation failed in an expected, user-actionable way.

Only truly unexpected conditions throw.

This is the canonical shape:

```ts
type UserErrorCode =
  | "validation_failed"
  | "authentication_failed"
  | "authorization_failed"
  | "not_found"
  | "conflict"
  | "precondition_failed"
  | "rate_limited"
  | "unavailable";

type UserError = {
  code: UserErrorCode;
  title?: string;
  message: string;
  fields?: Record<string, string[]>;
  retryable?: boolean;
  traceId?: string;
  metadata?: Record<string, unknown>;
};

type CommandResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "user_error"; error: UserError };
```

## Error Taxonomy

The app uses a small shared code set rather than screen-specific top-level categories. This keeps behavior stable across features and supports consistent analytics, retries, and rendering.

Rules for the taxonomy:

- Prefer reusing an existing code before adding a new one.
- Use `metadata` for feature detail instead of inventing many new codes.
- Use `fields` only for actionable validation data.
- Use `retryable` only when a retry is meaningfully supported.
- Treat `traceId` as optional and safe to show.

## Server Responsibilities

The server owns semantics, not presentation mechanics.

For every command:

- Return `kind: "ok"` on success.
- Return `kind: "user_error"` when the user can reasonably understand and act on the failure.
- Throw only for truly unexpected failures, infrastructure issues, or programmer faults.

Server rules:

- `message` must already be safe for user display.
- `title` is optional and should stay short.
- `fields` should identify specific field-level issues when relevant.
- Raw exception text, stack traces, schema dumps, and transport diagnostics must never be repackaged as user errors.

Expected business failures include examples such as:

- invalid credentials
- missing required linked record
- unauthorized action
- validation failure
- conflicting state
- temporary service unavailability

Unexpected failures include examples such as:

- uncaught exceptions
- schema mismatches
- null-reference defects
- malformed internal state
- transport/runtime faults outside the user contract

## Client Responsibilities

The client owns presentation and recovery behavior through one shared normalization path.

The client receives either:

- a `CommandResult<T>`
- or a thrown fault

It normalizes these into UI-safe categories:

- success
- presentable error
- unexpected error

The client must not infer safety from arbitrary exception strings. The only safe user-facing error text is:

- text carried in a `user_error`
- generic fallback copy produced by the client itself

## Surface Presentation Rules

Presentation is determined by the initiating surface.

### Durable Surfaces

Forms, dialogs, drawers, and pages with a natural error region render failures inline.

Behavior:

- clear stale inline errors before each submit
- render `user_error` inline in the surface
- optionally map `fields` to field-level validation states
- render generic fallback copy for `unexpected_error`
- allow immediate retry without requiring extra navigation

### Non-Durable Surfaces

Quick actions with no stable error region use toasts.

Behavior:

- toasts are a fallback, not the primary channel
- toast content comes from normalized outcomes, never raw exceptions
- `user_error` uses its safe message
- `unexpected_error` uses generic fallback copy

### Default User Experience

The agreed default for Athena is:

- inline when the action lives inside a form or modal
- toast otherwise

## Global Resilience Layer

Route and render boundaries are the final safety net.

They must:

- show generic recovery UI only
- never render raw backend or transport error text
- log faults for diagnostics
- offer safe recovery actions such as retry, back, or home
- optionally show a safe trace ID when available

The boundary is not responsible for business-failure UX. If a command fails in an expected way, that should be handled in the initiating surface long before the boundary is involved.

## Query and Read Failures

This design is command-first, but the same leak-prevention rules apply to reads.

Read/query guidance:

- prefer meaningful local loading and error states where a page or panel has context
- never display raw backend text from escaped read failures
- let the boundary catch only failures that escape local page composition

This keeps read-state UX compatible with the same safety model even before read patterns are fully standardized.

## Interaction Flow

Each command follows the same lifecycle:

1. The surface submits through a shared command runner.
2. Existing inline error state is cleared.
3. The runner executes the command.
4. If the result is `ok`, the surface proceeds normally.
5. If the result is `user_error`, the surface renders that safe error in its default channel.
6. If the command throws, the client converts it to an `unexpected_error` with generic fallback copy.
7. The raw thrown fault is logged but not displayed.

This makes components independent of Convex error text, transport behavior, and ad hoc parsing.

## Testing Strategy

The foundation should be tested at three levels.

### Contract Tests

Validate shared helpers and types:

- command result discriminants
- error normalization behavior
- generic fallback behavior for thrown faults
- field mapping behavior

### Server Tests

Validate that commands:

- return `user_error` for expected business failures
- throw for unexpected faults only
- never emit unsafe diagnostic text in the user error envelope

### UI Tests

Validate that surfaces:

- render inline errors in forms and modals
- use toasts only when no durable inline surface exists
- clear stale errors on retry
- show generic fallback copy for unexpected faults
- never render raw thrown server text

## Rollout Plan

Roll out the foundation in layers:

1. Define shared command result and user error contract.
2. Add the client normalizer and generic fallback rules.
3. Replace the global route/render boundary with a generic safe boundary.
4. Introduce shared surface patterns for inline command errors and toast fallbacks.
5. Migrate high-risk flows first, especially authentication and service operations.
6. Expand incrementally across remaining command surfaces.

This order delivers immediate leak prevention and resilience without requiring a full-app rewrite.

## Open Questions

These questions do not block the design, but should be resolved during implementation planning:

- whether `traceId` is available now or introduced later
- whether field-error metadata should support nested field paths
- whether retry affordances should be standardized in the first implementation or deferred
- how aggressively to adapt existing mixed patterns during migration

## Decision Summary

The foundation for Athena client/server error handling is:

- result-first for expected command failures
- typed shared user-error contract
- generic-only handling for unexpected thrown faults
- inline error rendering for forms and modals
- toast fallback for actions without a durable inline surface
- generic global boundary as the final backstop

This creates a stable, resilient, and non-leaky base that future app features can build on uniformly.
