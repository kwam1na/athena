# Athena Webapp Agent Docs

- [Architecture](./architecture.md)
- [Testing](./testing.md)
- [Code map](./code-map.md)
- [Route index](./route-index.md)
- [Test index](./test-index.md)
- [Key folder index](./key-folder-index.md)
- [Validation guide](./validation-guide.md)

Use this harness when the task touches the authenticated dashboard shell in [src/main.tsx](../../src/main.tsx), route files under [src/routes/_authed.tsx](../../src/routes/_authed.tsx), or the Convex-backed HTTP surface in [convex/http.ts](../../convex/http.ts).

The generated indexes above are the fastest way to confirm the current route set, test surface layout, and package landmarks before you read deeper docs.

Key boundaries to keep in mind:

- Browser entry and generated TanStack Router state live in [src/main.tsx](../../src/main.tsx) and [src/routeTree.gen.ts](../../src/routeTree.gen.ts).
- Inventory and storefront backend routes are composed in [convex/http.ts](../../convex/http.ts) over the schema in [convex/schema.ts](../../convex/schema.ts).
- App-level auth and shell state usually fan out from [src/hooks/useAuth.ts](../../src/hooks/useAuth.ts) and the authenticated layout in [src/routes/_authed.tsx](../../src/routes/_authed.tsx).
- Shared workflow traces now converge under [convex/workflowTraces](../../convex/workflowTraces), the shared trace contract in [shared/workflowTrace.ts](../../shared/workflowTrace.ts), the store-scoped route in [src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/traces/$traceId.tsx](../../src/routes/_authed/$orgUrlSlug/store/$storeUrlSlug/traces/$traceId.tsx), and the reusable trace UI in [src/components/traces/WorkflowTraceView.tsx](../../src/components/traces/WorkflowTraceView.tsx).
- POS workflow traces now layer on top of that foundation through [convex/workflowTraces/adapters/posSession.ts](../../convex/workflowTraces/adapters/posSession.ts), [convex/workflowTraces/adapters/registerSession.ts](../../convex/workflowTraces/adapters/registerSession.ts), the write-path helpers in [convex/pos/application/commands/posSessionTracing.ts](../../convex/pos/application/commands/posSessionTracing.ts) and [convex/operations/registerSessionTracing.ts](../../convex/operations/registerSessionTracing.ts), and the operator entry points under [src/components/pos](../../src/components/pos), [src/components/pos/transactions](../../src/components/pos/transactions), and [src/components/cash-controls](../../src/components/cash-controls).
- POS register bootstrap now pauses behind the drawer gate in [src/components/pos/register/POSRegisterView.tsx](../../src/components/pos/register/POSRegisterView.tsx) and [src/lib/pos/presentation/register/useRegisterViewModel.ts](../../src/lib/pos/presentation/register/useRegisterViewModel.ts); confirm the downstream result in [src/components/cash-controls/CashControlsDashboard.tsx](../../src/components/cash-controls/CashControlsDashboard.tsx) and [src/components/cash-controls/RegisterSessionView.tsx](../../src/components/cash-controls/RegisterSessionView.tsx) whenever drawer-opening behavior changes.
- Client/server command failures now converge through the browser-safe shared contract in [shared/commandResult.ts](../../shared/commandResult.ts), the client normalizers in [src/lib/errors/runCommand.ts](../../src/lib/errors/runCommand.ts) and [src/lib/errors/presentCommandToast.ts](../../src/lib/errors/presentCommandToast.ts), the shared unexpected-toast helper in [src/lib/errors/presentUnexpectedErrorToast.ts](../../src/lib/errors/presentUnexpectedErrorToast.ts), and the generic route backstop in [src/components/auth/DefaultCatchBoundary.tsx](../../src/components/auth/DefaultCatchBoundary.tsx). Expected command failures return `user_error`; thrown faults collapse to generic fallback copy; durable surfaces render inline by default; toast is the fallback only when no durable error region exists.
- Login auth sync and store-configuration admin flows now layer on top of [convex/inventory/auth.ts](../../convex/inventory/auth.ts), [convex/inventory/stores.ts](../../convex/inventory/stores.ts), [src/routes/login/_layout.tsx](../../src/routes/login/_layout.tsx), and [src/components/store-configuration/index.tsx](../../src/components/store-configuration/index.tsx). Route store-config saves through [src/components/store-configuration/hooks/useStoreConfigUpdate.ts](../../src/components/store-configuration/hooks/useStoreConfigUpdate.ts) so maintenance, fulfillment, fees, tax, contact, and MoMo edits all normalize `CommandResult` failures the same way.
- Staff provisioning and subsystem sign-in now hang off [convex/operations/staffProfiles.ts](../../convex/operations/staffProfiles.ts), [convex/operations/staffCredentials.ts](../../convex/operations/staffCredentials.ts), [src/components/staff/StaffManagement.tsx](../../src/components/staff/StaffManagement.tsx), [src/components/pos/CashierAuthDialog.tsx](../../src/components/pos/CashierAuthDialog.tsx), and [src/components/expense/ExpenseView.tsx](../../src/components/expense/ExpenseView.tsx). Staff records now require first name, last name, username, and role up front; start date is optional; the roster payloads expose `username`, `primaryRole`, and `credentialStatus`; managers can edit provisioned staff details after creation; and PIN setup/reset happens later from staff management. Treat `staffProfileId` as the canonical operator identity across POS, expense, services, and cash controls.
- Stock adjustments, purchase-order workflows, replenishment guidance, and receiving now converge under `convex/stockOps/*` plus the operator views in `src/components/operations` and `src/components/procurement`; approval, adjustment, and receiving commands in this slice now follow the shared command-result contract instead of leaking thrown backend text into queue and procurement toasts.
- Omnichannel returns, exchanges, order updates, refunds, review moderation, and follow-up history now converge under `convex/storeFront/*` plus the operator views in `src/components/orders`, `src/components/reviews`, and `src/components/users`; treat [convex/storeFront/onlineOrder.ts](../../convex/storeFront/onlineOrder.ts), [convex/storeFront/payment.ts](../../convex/storeFront/payment.ts), [convex/storeFront/reviews.ts](../../convex/storeFront/reviews.ts), and [convex/storeFront/onlineOrderUtilFns.ts](../../convex/storeFront/onlineOrderUtilFns.ts) as the command-result boundary for this slice.

Common validation commands:

- `bun run --filter '@athena/webapp' test`
- `bun run --filter '@athena/webapp' audit:convex`
- `bun run --filter '@athena/webapp' lint:convex:changed`
- `bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json`
- `bun run --filter '@athena/webapp' build`

Generated Convex client note:

- If you need refreshed `convex/_generated` artifacts or new client refs, start `bunx convex dev` from `packages/athena-webapp`.
- Do not default to `bunx convex codegen`; in this repo it can fail in local workspaces that do not have `CONVEX_DEPLOYMENT` configured.
