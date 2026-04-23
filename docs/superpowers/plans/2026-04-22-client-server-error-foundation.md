# Client Server Error Foundation Implementation Plan

> Status: Executed on 2026-04-22 through Linear tickets `V26-348` to `V26-353`. The checklist below is the original implementation plan artifact, not a live status board.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a stable client/server error foundation for Athena so expected command failures are returned as safe data, unexpected faults never leak backend text, and initiating surfaces render failures inline or via toast consistently.

**Architecture:** Introduce a shared command-result and user-error contract in `packages/athena-webapp/shared/`, add a client normalization layer plus a generic global catch boundary, then migrate two proving paths end-to-end: service intake for inline handling and cashier authentication for toast fallback. Keep the first rollout intentionally narrow, but make the new contract reusable so later command surfaces can adopt it without inventing new patterns.

**Tech Stack:** TypeScript, React, TanStack Router, Convex, Sonner, Vitest, Testing Library

---

## File Map

- Create: `packages/athena-webapp/shared/commandResult.ts`
- Create: `packages/athena-webapp/shared/commandResult.test.ts`
- Create: `packages/athena-webapp/src/lib/errors/runCommand.ts`
- Create: `packages/athena-webapp/src/lib/errors/runCommand.test.ts`
- Create: `packages/athena-webapp/src/lib/errors/presentCommandToast.ts`
- Create: `packages/athena-webapp/src/lib/errors/presentCommandToast.test.ts`
- Create: `packages/athena-webapp/src/components/auth/DefaultCatchBoundary.test.tsx`
- Create: `packages/athena-webapp/src/components/pos/CashierAuthDialog.test.tsx`
- Modify: `packages/athena-webapp/src/components/auth/DefaultCatchBoundary.tsx`
- Modify: `packages/athena-webapp/src/routes/__root.tsx`
- Modify: `packages/athena-webapp/convex/operations/serviceIntake.ts`
- Modify: `packages/athena-webapp/convex/operations/serviceIntake.test.ts`
- Modify: `packages/athena-webapp/convex/operations/staffCredentials.ts`
- Modify: `packages/athena-webapp/convex/operations/staffCredentials.test.ts`
- Modify: `packages/athena-webapp/src/components/services/ServiceIntakeView.tsx`
- Modify: `packages/athena-webapp/src/components/services/ServiceIntakeView.test.tsx`
- Modify: `packages/athena-webapp/src/components/services/ServiceIntakeView.auth.test.tsx`
- Modify: `packages/athena-webapp/src/components/pos/CashierAuthDialog.tsx`
- Modify: `packages/athena-webapp/src/lib/pos/application/results.ts`
- Modify: `packages/athena-webapp/src/lib/pos/toastService.ts`

### Responsibilities

- `shared/commandResult.ts`: app-wide safe contract for `CommandResult`, `UserError`, helpers, and fallback constants. Keep this outside `convex/` so both client and server can import it without breaking `src/routeTree.browser-boundary.test.ts`.
- `src/lib/errors/runCommand.ts`: normalize a command result or thrown fault into a UI-safe outcome.
- `src/lib/errors/presentCommandToast.ts`: toast fallback that only renders safe `user_error` copy or generic fallback copy.
- `DefaultCatchBoundary`: final generic backstop for escaped route/render faults.
- `serviceIntake.ts` and `staffCredentials.ts`: first server proving paths that return `user_error` instead of throwing for expected failures.
- `ServiceIntakeView.tsx`: first inline surface proving path.
- `CashierAuthDialog.tsx`: first toast-only surface proving path.
- `src/lib/pos/application/results.ts` and `src/lib/pos/toastService.ts`: bridge the existing POS error helpers onto the new shared foundation so we do not preserve a second error dialect.

### Task 1: Add The Shared Command Result Contract

**Files:**
- Create: `packages/athena-webapp/shared/commandResult.ts`
- Test: `packages/athena-webapp/shared/commandResult.test.ts`

- [ ] **Step 1: Write the failing shared-contract tests**

```ts
import { describe, expect, it } from "vitest";

import {
  GENERIC_UNEXPECTED_ERROR_MESSAGE,
  GENERIC_UNEXPECTED_ERROR_TITLE,
  isUserErrorResult,
  ok,
  userError,
} from "./commandResult";

describe("command result helpers", () => {
  it("wraps success payloads with the ok discriminant", () => {
    expect(ok({ serviceCaseId: "service-case-1" })).toEqual({
      kind: "ok",
      data: { serviceCaseId: "service-case-1" },
    });
  });

  it("wraps user-facing failures with the user_error discriminant", () => {
    expect(
      userError({
        code: "validation_failed",
        message: "A service title is required.",
      }),
    ).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "A service title is required.",
      },
    });
  });

  it("detects user error results without inspecting exception text", () => {
    const result = userError({
      code: "authentication_failed",
      message: "Invalid staff credentials.",
    });

    expect(isUserErrorResult(result)).toBe(true);
  });

  it("exports the generic fallback copy for unexpected faults", () => {
    expect(GENERIC_UNEXPECTED_ERROR_TITLE).toBe("Something went wrong");
    expect(GENERIC_UNEXPECTED_ERROR_MESSAGE).toBe(
      "Please try again.",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/kwamina/athena/packages/athena-webapp && bun run test -- shared/commandResult.test.ts`

Expected: FAIL with `Cannot find module './commandResult'` or missing export errors.

- [ ] **Step 3: Write the minimal shared contract**

```ts
export const USER_ERROR_CODES = [
  "validation_failed",
  "authentication_failed",
  "authorization_failed",
  "not_found",
  "conflict",
  "precondition_failed",
  "rate_limited",
  "unavailable",
] as const;

export type UserErrorCode = (typeof USER_ERROR_CODES)[number];

export type UserError = {
  code: UserErrorCode;
  title?: string;
  message: string;
  fields?: Record<string, string[]>;
  retryable?: boolean;
  traceId?: string;
  metadata?: Record<string, unknown>;
};

export type CommandResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "user_error"; error: UserError };

export const GENERIC_UNEXPECTED_ERROR_TITLE = "Something went wrong";
export const GENERIC_UNEXPECTED_ERROR_MESSAGE = "Please try again.";

export function ok<T>(data: T): CommandResult<T> {
  return { kind: "ok", data };
}

export function userError(error: UserError): CommandResult<never> {
  return { kind: "user_error", error };
}

export function isUserErrorResult<T>(
  result: CommandResult<T>,
): result is { kind: "user_error"; error: UserError } {
  return result.kind === "user_error";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/kwamina/athena/packages/athena-webapp && bun run test -- shared/commandResult.test.ts`

Expected: PASS with 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add \
  /Users/kwamina/athena/packages/athena-webapp/shared/commandResult.ts \
  /Users/kwamina/athena/packages/athena-webapp/shared/commandResult.test.ts
git commit -m "feat: add shared command result contract"
```

### Task 2: Add Client Normalization And The Generic Catch Boundary

**Files:**
- Create: `packages/athena-webapp/src/lib/errors/runCommand.ts`
- Create: `packages/athena-webapp/src/lib/errors/runCommand.test.ts`
- Create: `packages/athena-webapp/src/components/auth/DefaultCatchBoundary.test.tsx`
- Modify: `packages/athena-webapp/src/components/auth/DefaultCatchBoundary.tsx`
- Modify: `packages/athena-webapp/src/routes/__root.tsx`

- [ ] **Step 1: Write the failing normalizer and boundary tests**

```ts
import { describe, expect, it } from "vitest";

import { ok, userError } from "~/shared/commandResult";
import { runCommand } from "./runCommand";

describe("runCommand", () => {
  it("passes through ok results", async () => {
    await expect(
      runCommand(async () => ok({ terminalId: "terminal-1" })),
    ).resolves.toEqual({
      kind: "ok",
      data: { terminalId: "terminal-1" },
    });
  });

  it("passes through user_error results", async () => {
    await expect(
      runCommand(async () =>
        userError({
          code: "authentication_failed",
          message: "Invalid staff credentials.",
        }),
      ),
    ).resolves.toEqual({
      kind: "user_error",
      error: {
        code: "authentication_failed",
        message: "Invalid staff credentials.",
      },
    });
  });

  it("normalizes thrown faults to generic fallback copy", async () => {
    await expect(
      runCommand(async () => {
        throw new Error("[CONVEX] exploded with internal details");
      }),
    ).resolves.toEqual({
      kind: "unexpected_error",
      error: {
        title: "Something went wrong",
        message: "Please try again.",
      },
    });
  });
});
```

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DefaultCatchBoundary } from "./DefaultCatchBoundary";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  rootRouteId: "__root__",
  useMatch: () => true,
  useRouter: () => ({ invalidate: vi.fn() }),
}));

describe("DefaultCatchBoundary", () => {
  it("shows generic fallback copy without rendering raw error details", () => {
    render(
      <DefaultCatchBoundary error={new Error("Internal schema dump")} info={{}} />,
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.queryByText("Internal schema dump")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/kwamina/athena/packages/athena-webapp && bun run test -- src/lib/errors/runCommand.test.ts src/components/auth/DefaultCatchBoundary.test.tsx`

Expected: FAIL because `runCommand.ts` and the new boundary behavior do not exist yet.

- [ ] **Step 3: Write the normalizer and generic boundary**

```ts
import {
  type CommandResult,
  GENERIC_UNEXPECTED_ERROR_MESSAGE,
  GENERIC_UNEXPECTED_ERROR_TITLE,
} from "~/shared/commandResult";

export type NormalizedCommandResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "user_error"; error: CommandResult<T> extends { kind: "user_error"; error: infer TError } ? TError : never }
  | {
      kind: "unexpected_error";
      error: {
        title: string;
        message: string;
        traceId?: string;
      };
    };

export async function runCommand<T>(
  command: () => Promise<CommandResult<T>>,
): Promise<NormalizedCommandResult<T>> {
  try {
    return await command();
  } catch (error) {
    const traceId =
      error instanceof Error && /trace[:=]\s*([a-z0-9_-]+)/i.test(error.message)
        ? error.message.match(/trace[:=]\s*([a-z0-9_-]+)/i)?.[1]
        : undefined;

    return {
      kind: "unexpected_error",
      error: {
        title: GENERIC_UNEXPECTED_ERROR_TITLE,
        message: GENERIC_UNEXPECTED_ERROR_MESSAGE,
        traceId,
      },
    };
  }
}
```

```tsx
export function DefaultCatchBoundary({ error }: ErrorComponentProps) {
  const router = useRouter();
  const isRoot = useMatch({
    strict: false,
    select: (state) => state.id === rootRouteId,
  });

  console.error(error);

  return (
    <div className="min-w-0 flex-1 p-6 flex flex-col items-center justify-center gap-4">
      <div className="max-w-md text-center space-y-2">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          Please try again. If the problem keeps happening, go back and retry the action.
        </p>
      </div>
      <div className="flex gap-2 items-center flex-wrap">
        <button
          onClick={() => {
            router.invalidate();
          }}
          className="px-3 py-2 bg-gray-600 rounded text-white font-semibold"
        >
          Try Again
        </button>
        {isRoot ? <Link to="/">Home</Link> : <Link to="/">Go Back</Link>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/kwamina/athena/packages/athena-webapp && bun run test -- src/lib/errors/runCommand.test.ts src/components/auth/DefaultCatchBoundary.test.tsx src/routeTree.browser-boundary.test.ts`

Expected: PASS with the new tests green and the browser-boundary test still green.

- [ ] **Step 5: Commit**

```bash
git add \
  /Users/kwamina/athena/packages/athena-webapp/src/lib/errors/runCommand.ts \
  /Users/kwamina/athena/packages/athena-webapp/src/lib/errors/runCommand.test.ts \
  /Users/kwamina/athena/packages/athena-webapp/src/components/auth/DefaultCatchBoundary.tsx \
  /Users/kwamina/athena/packages/athena-webapp/src/components/auth/DefaultCatchBoundary.test.tsx \
  /Users/kwamina/athena/packages/athena-webapp/src/routes/__root.tsx
git commit -m "feat: add generic client error normalization"
```

### Task 3: Add The Shared Toast Fallback Helper

**Files:**
- Create: `packages/athena-webapp/src/lib/errors/presentCommandToast.ts`
- Create: `packages/athena-webapp/src/lib/errors/presentCommandToast.test.ts`
- Modify: `packages/athena-webapp/src/lib/pos/toastService.ts`

- [ ] **Step 1: Write the failing toast helper test inside the existing POS toast test surface**

```ts
import { describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { presentCommandToast } from "./presentCommandToast";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe("presentCommandToast", () => {
  it("renders the safe user_error message", () => {
    presentCommandToast({
      kind: "user_error",
      error: {
        code: "authentication_failed",
        message: "Invalid staff credentials.",
      },
    });

    expect(toast.error).toHaveBeenCalledWith("Invalid staff credentials.");
  });

  it("renders generic fallback copy for unexpected faults", () => {
    presentCommandToast({
      kind: "unexpected_error",
      error: {
        title: "Something went wrong",
        message: "Please try again.",
      },
    });

    expect(toast.error).toHaveBeenCalledWith("Please try again.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/kwamina/athena/packages/athena-webapp && bun run test -- src/lib/errors/presentCommandToast.test.ts`

Expected: FAIL because `presentCommandToast.ts` and the test file do not exist yet.

- [ ] **Step 3: Write the helper and bridge POS toast handling onto it**

```ts
import { toast } from "sonner";

import type { NormalizedCommandResult } from "./runCommand";

export function presentCommandToast(result: Exclude<NormalizedCommandResult<unknown>, { kind: "ok" }>) {
  if (result.kind === "user_error") {
    toast.error(result.error.message);
    return;
  }

  toast.error(result.error.message);
}
```

```ts
const errorMessage =
  result.kind === "user_error"
    ? result.error.message
    : result.error.message;

toast.error(errorMessage, errorToastOptions);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/kwamina/athena/packages/athena-webapp && bun run test -- src/lib/errors/presentCommandToast.test.ts src/tests/pos/simple.test.ts`

Expected: PASS with the toast helper green and the existing POS smoke test still green.

- [ ] **Step 5: Commit**

```bash
git add \
  /Users/kwamina/athena/packages/athena-webapp/src/lib/errors/presentCommandToast.ts \
  /Users/kwamina/athena/packages/athena-webapp/src/lib/errors/presentCommandToast.test.ts \
  /Users/kwamina/athena/packages/athena-webapp/src/lib/pos/toastService.ts
git commit -m "feat: add safe toast presentation helper"
```

### Task 4: Convert Service Intake To The New Server Contract

**Files:**
- Modify: `packages/athena-webapp/convex/operations/serviceIntake.ts`
- Modify: `packages/athena-webapp/convex/operations/serviceIntake.test.ts`

- [ ] **Step 1: Write failing server tests for expected user errors**

```ts
import { describe, expect, it } from "vitest";

import { createServiceIntake } from "./serviceIntake";

describe("service intake command contract", () => {
  it("returns a validation user_error for incomplete intake commands", async () => {
    const result = await createServiceIntake.handler({} as never, {
      assignedStaffProfileId: "staff_1" as never,
      serviceTitle: "",
      storeId: "store_1" as never,
      intakeChannel: "walk_in",
    });

    expect(result).toEqual({
      kind: "user_error",
      error: expect.objectContaining({
        code: "validation_failed",
      }),
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/kwamina/athena/packages/athena-webapp && bun run test -- convex/operations/serviceIntake.test.ts`

Expected: FAIL because the mutation still throws for expected failures instead of returning `user_error`.

- [ ] **Step 3: Implement the new command result path**

```ts
import { ok, userError, type CommandResult } from "../../shared/commandResult";

type CreateServiceIntakeData = {
  serviceCaseId: Id<"serviceCase">;
};

export const createServiceIntake = mutation({
  args: {
    assignedStaffProfileId: v.id("staffProfile"),
    createdByUserId: v.optional(v.id("athenaUser")),
    customerEmail: v.optional(v.string()),
    customerFullName: v.optional(v.string()),
    customerNotes: v.optional(v.string()),
    customerPhoneNumber: v.optional(v.string()),
    customerProfileId: v.optional(v.id("customerProfile")),
    depositAmount: v.optional(v.number()),
    depositMethod: v.optional(
      v.union(v.literal("cash"), v.literal("card"), v.literal("mobile_money")),
    ),
    intakeChannel: v.union(v.literal("walk_in"), v.literal("phone_booking")),
    itemDescription: v.optional(v.string()),
    notes: v.optional(v.string()),
    priority: v.optional(
      v.union(v.literal("normal"), v.literal("high"), v.literal("urgent")),
    ),
    registerSessionId: v.optional(v.id("registerSession")),
    scheduledAt: v.optional(v.number()),
    serviceTitle: v.string(),
    storeId: v.id("store"),
  },
  handler: async (ctx, args): Promise<CommandResult<CreateServiceIntakeData>> => {
    const validationErrors = validateServiceIntakeInput({
      assignedStaffProfileId: args.assignedStaffProfileId,
      customerFullName: args.customerFullName,
      customerProfileId: args.customerProfileId,
      depositAmount: args.depositAmount,
      depositMethod: args.depositMethod,
      serviceTitle: args.serviceTitle,
    });

    if (validationErrors.length > 0) {
      return userError({
        code: "validation_failed",
        title: "Fix the highlighted intake details.",
        message: validationErrors[0],
        fields: {
          form: validationErrors,
        },
      });
    }

    if (!assignedStaffProfile || assignedStaffProfile.storeId !== args.storeId) {
      return userError({
        code: "precondition_failed",
        message: "Assigned staff member is not available for this store.",
      });
    }

    return ok({
      serviceCaseId,
    });
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/kwamina/athena/packages/athena-webapp && bun run test -- convex/operations/serviceIntake.test.ts`

Expected: PASS with validation tests green and at least one assertion covering the `user_error` shape.

- [ ] **Step 5: Commit**

```bash
git add \
  /Users/kwamina/athena/packages/athena-webapp/convex/operations/serviceIntake.ts \
  /Users/kwamina/athena/packages/athena-webapp/convex/operations/serviceIntake.test.ts
git commit -m "feat: return service intake user errors"
```

### Task 5: Convert Staff Credential Authentication To The New Server Contract

**Files:**
- Modify: `packages/athena-webapp/convex/operations/staffCredentials.ts`
- Modify: `packages/athena-webapp/convex/operations/staffCredentials.test.ts`

- [ ] **Step 1: Write failing tests for authentication and precondition user errors**

```ts
import { describe, expect, it } from "vitest";

import { authenticateStaffCredentialForTerminalWithCtx } from "./staffCredentials";

describe("staff credential command contract", () => {
  it("returns a safe authentication_failed result for invalid credentials", async () => {
    const { ctx } = createStaffCredentialsMutationCtx({
      credentials: [],
      profiles: [],
      roles: [],
    });

    await expect(
      authenticateStaffCredentialForTerminalWithCtx(ctx, {
        allowedRoles: ["cashier"],
        pinHash: "hash-1",
        storeId: "store_1" as never,
        terminalId: "terminal_1" as never,
        username: "frontdesk",
      }),
    ).resolves.toEqual({
      kind: "user_error",
      error: expect.objectContaining({
        code: "authentication_failed",
        message: "Invalid staff credentials.",
      }),
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/kwamina/athena/packages/athena-webapp && bun run test -- convex/operations/staffCredentials.test.ts`

Expected: FAIL because the authentication helpers still throw for invalid credentials and cross-terminal conflicts.

- [ ] **Step 3: Implement expected authentication failures as `user_error`**

```ts
import { ok, userError, type CommandResult } from "../../shared/commandResult";

type AuthenticateStaffCredentialData = {
  activeRoles: OperationalRole[];
  credentialId: Id<"staffCredential">;
  staffProfile: Doc<"staffProfile">;
  staffProfileId: Id<"staffProfile">;
};

export async function authenticateStaffCredentialWithCtx(
  ctx: Pick<MutationCtx, "db">,
  args: {
    allowedRoles?: OperationalRole[];
    pinHash: string;
    storeId: Id<"store">;
    username: string;
  },
): Promise<CommandResult<AuthenticateStaffCredentialData>> {
  if (!activeCredential || !activeCredential.pinHash || activeCredential.pinHash !== args.pinHash) {
    return userError({
      code: "authentication_failed",
      message: "Invalid staff credentials.",
    });
  }

  if (authorizedRoles.length === 0) {
    return userError({
      code: "authorization_failed",
      message: "Staff profile is not authorized for this subsystem.",
    });
  }

  return ok({
    activeRoles: authorizedRoles.map((role) => role.role),
    credentialId: activeCredential._id,
    staffProfile,
    staffProfileId: activeCredential.staffProfileId,
  });
}

export async function authenticateStaffCredentialForTerminalWithCtx(
  ctx: Pick<MutationCtx, "db">,
  args: {
    allowedRoles?: OperationalRole[];
    pinHash: string;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    username: string;
  },
): Promise<CommandResult<AuthenticateStaffCredentialData>> {
  const authentication = await authenticateStaffCredentialWithCtx(ctx, args);

  if (authentication.kind === "user_error") {
    return authentication;
  }

  if (activeSessionsOnOtherTerminals.length > 0) {
    return userError({
      code: "precondition_failed",
      message: "This staff member has an active session on another terminal.",
    });
  }

  return authentication;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/kwamina/athena/packages/athena-webapp && bun run test -- convex/operations/staffCredentials.test.ts`

Expected: PASS with the new user-error assertions and the existing credential rules still green.

- [ ] **Step 5: Commit**

```bash
git add \
  /Users/kwamina/athena/packages/athena-webapp/convex/operations/staffCredentials.ts \
  /Users/kwamina/athena/packages/athena-webapp/convex/operations/staffCredentials.test.ts
git commit -m "feat: return staff credential user errors"
```

### Task 6: Migrate Service Intake To Inline Error Presentation

**Files:**
- Modify: `packages/athena-webapp/src/components/services/ServiceIntakeView.tsx`
- Modify: `packages/athena-webapp/src/components/services/ServiceIntakeView.test.tsx`
- Modify: `packages/athena-webapp/src/components/services/ServiceIntakeView.auth.test.tsx`

- [ ] **Step 1: Write the failing UI tests for server-side inline errors**

```tsx
it("renders a safe inline server error instead of a toast description", async () => {
  const user = userEvent.setup();
  const onCreateIntake = vi.fn().mockResolvedValue({
    kind: "user_error",
    error: {
      code: "precondition_failed",
      message: "Assigned staff member is not available for this store.",
    },
  });

  render(
    <ServiceIntakeViewContent
      {...baseProps}
      onCreateIntake={onCreateIntake}
    />,
  );

  await user.type(screen.getByLabelText(/service title/i), "Wash and restyle");
  await chooseSelectOption(user, /assigned staff/i, /adjoa tetteh/i);
  await user.type(screen.getByLabelText(/customer name/i), "Ama Mensah");
  await user.click(screen.getByRole("button", { name: /create intake/i }));

  expect(
    await screen.findByText("Assigned staff member is not available for this store."),
  ).toBeInTheDocument();
  expect(toast.error).not.toHaveBeenCalled();
});

it("renders generic inline copy when the mutation throws unexpectedly", async () => {
  const user = userEvent.setup();
  const onCreateIntake = vi.fn().mockRejectedValue(
    new Error("[CONVEX] schema details should stay hidden"),
  );

  render(
    <ServiceIntakeViewContent
      {...baseProps}
      onCreateIntake={onCreateIntake}
    />,
  );

  await user.type(screen.getByLabelText(/service title/i), "Wash and restyle");
  await chooseSelectOption(user, /assigned staff/i, /adjoa tetteh/i);
  await user.type(screen.getByLabelText(/customer name/i), "Ama Mensah");
  await user.click(screen.getByRole("button", { name: /create intake/i }));

  expect(await screen.findByText("Please try again.")).toBeInTheDocument();
  expect(
    screen.queryByText(/\[CONVEX\] schema details should stay hidden/i),
  ).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/kwamina/athena/packages/athena-webapp && bun run test -- src/components/services/ServiceIntakeView.test.tsx src/components/services/ServiceIntakeView.auth.test.tsx`

Expected: FAIL because the component still expects `onCreateIntake` to resolve `void` and still uses `toast.error(...description: error.message)`.

- [ ] **Step 3: Implement inline normalization in the surface**

```tsx
import { runCommand } from "@/lib/errors/runCommand";
import type { CommandResult } from "~/shared/commandResult";

type CreateServiceIntakeResult = CommandResult<{
  serviceCaseId: Id<"serviceCase">;
}>;

type ServiceIntakeViewContentProps = {
  customerResults: ServiceIntakeCustomerResult[];
  hasFullAdminAccess: boolean;
  isLoadingPermissions: boolean;
  isSubmitting: boolean;
  onCreateIntake: (args: CreateServiceIntakeArgs) => Promise<CreateServiceIntakeResult>;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  staffOptions: ServiceIntakeStaffOption[] | undefined;
  storeId?: Id<"store">;
  userId?: Id<"athenaUser">;
};

const [validationErrors, setValidationErrors] = useState<string[]>([]);

const normalizedResult = await runCommand(() =>
  onCreateIntake({
    assignedStaffProfileId: form.assignedStaffProfileId as Id<"staffProfile">,
    createdByUserId: userId,
    customerEmail: form.customerEmail || undefined,
    customerFullName: form.customerFullName || undefined,
    customerNotes: form.customerNotes || undefined,
    customerPhoneNumber: form.customerPhoneNumber || undefined,
    customerProfileId:
      (form.selectedCustomerId as Id<"customerProfile"> | undefined) ?? undefined,
    depositAmount: parsedDepositAmount,
    depositMethod:
      (form.depositMethod as "cash" | "card" | "mobile_money") || undefined,
    intakeChannel: form.intakeChannel,
    itemDescription: form.itemDescription || undefined,
    notes: form.notes || undefined,
    priority: form.priority,
    serviceTitle: form.serviceTitle.trim(),
    storeId,
  }),
);

if (normalizedResult.kind === "user_error") {
  setValidationErrors(
    normalizedResult.error.fields?.form ?? [normalizedResult.error.message],
  );
  return;
}

if (normalizedResult.kind === "unexpected_error") {
  setValidationErrors([normalizedResult.error.message]);
  return;
}

toast.success("Service intake created");
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/kwamina/athena/packages/athena-webapp && bun run test -- src/components/services/ServiceIntakeView.test.tsx src/components/services/ServiceIntakeView.auth.test.tsx`

Expected: PASS with the new inline-error assertions green and no regression to auth readiness behavior.

- [ ] **Step 5: Commit**

```bash
git add \
  /Users/kwamina/athena/packages/athena-webapp/src/components/services/ServiceIntakeView.tsx \
  /Users/kwamina/athena/packages/athena-webapp/src/components/services/ServiceIntakeView.test.tsx \
  /Users/kwamina/athena/packages/athena-webapp/src/components/services/ServiceIntakeView.auth.test.tsx
git commit -m "feat: render service intake command failures inline"
```

### Task 7: Migrate Cashier Authentication To Safe Toast Fallback

**Files:**
- Create: `packages/athena-webapp/src/components/pos/CashierAuthDialog.test.tsx`
- Modify: `packages/athena-webapp/src/components/pos/CashierAuthDialog.tsx`
- Modify: `packages/athena-webapp/src/lib/pos/application/results.ts`

- [ ] **Step 1: Write the failing authentication-dialog tests**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { CashierAuthDialog } from "./CashierAuthDialog";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

it("shows the safe user_error toast for invalid credentials", async () => {
  const user = userEvent.setup();
  mockedUseMutation
    .mockReturnValueOnce(
      vi.fn().mockResolvedValue({
        kind: "user_error",
        error: {
          code: "authentication_failed",
          message: "Invalid staff credentials.",
        },
      }),
    )
    .mockReturnValueOnce(vi.fn());

  render(
    <CashierAuthDialog
      open
      onAuthenticated={vi.fn()}
      onDismiss={vi.fn()}
      storeId={"store-1" as never}
      terminalId={"terminal-1" as never}
    />,
  );

  await user.type(screen.getByLabelText(/username/i), "jsm");
  await user.type(screen.getByLabelText(/pin/i), "123456");

  await waitFor(() => {
    expect(toast.error).toHaveBeenCalledWith("Invalid staff credentials.");
  });
});

it("shows generic fallback copy for unexpected thrown faults", async () => {
  const user = userEvent.setup();
  mockedUseMutation
    .mockReturnValueOnce(
      vi.fn().mockRejectedValue(
        new Error("[CONVEX] server dump should not be displayed"),
      ),
    )
    .mockReturnValueOnce(vi.fn());

  render(
    <CashierAuthDialog
      open
      onAuthenticated={vi.fn()}
      onDismiss={vi.fn()}
      storeId={"store-1" as never}
      terminalId={"terminal-1" as never}
    />,
  );

  await user.type(screen.getByLabelText(/username/i), "jsm");
  await user.type(screen.getByLabelText(/pin/i), "123456");

  await waitFor(() => {
    expect(toast.error).toHaveBeenCalledWith("Please try again.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/kwamina/athena/packages/athena-webapp && bun run test -- src/components/pos/CashierAuthDialog.test.tsx`

Expected: FAIL because the dialog still expects thrown exceptions and still displays `error.message` directly.

- [ ] **Step 3: Implement safe toast fallback**

```tsx
import { runCommand } from "@/lib/errors/runCommand";
import { presentCommandToast } from "@/lib/errors/presentCommandToast";

const result = await runCommand(() =>
  authenticateStaffCredentialForTerminal({
    allowedRoles: ["cashier", "manager"],
    username: username.trim(),
    pinHash: hashed,
    storeId,
    terminalId,
  }),
);

if (result.kind !== "ok") {
  presentCommandToast(result);
  setPin("");
  return;
}

const staffDisplayName =
  result.data.staffProfile.fullName ||
  [result.data.staffProfile.firstName, result.data.staffProfile.lastName]
    .filter(Boolean)
    .join(" ");
```

```ts
import { GENERIC_UNEXPECTED_ERROR_MESSAGE } from "~/shared/commandResult";

export function mapThrownError<TData = never>(
  _error: unknown,
): PosUseCaseResult<TData> {
  return {
    ok: false,
    code: "unknown",
    message: GENERIC_UNEXPECTED_ERROR_MESSAGE,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/kwamina/athena/packages/athena-webapp && bun run test -- src/components/pos/CashierAuthDialog.test.tsx src/lib/pos/presentation/register/useRegisterViewModel.test.ts`

Expected: PASS with the cashier dialog green and the larger POS view-model test suite still green.

- [ ] **Step 5: Commit**

```bash
git add \
  /Users/kwamina/athena/packages/athena-webapp/src/components/pos/CashierAuthDialog.tsx \
  /Users/kwamina/athena/packages/athena-webapp/src/components/pos/CashierAuthDialog.test.tsx \
  /Users/kwamina/athena/packages/athena-webapp/src/lib/pos/application/results.ts
git commit -m "feat: sanitize cashier auth failures"
```

### Task 8: Run Foundation Verification And Regenerate Graph Artifacts

**Files:**
- Modify: `packages/athena-webapp/src/routes/__root.tsx`
- Modify: `packages/athena-webapp/src/components/auth/DefaultCatchBoundary.tsx`
- Modify: `packages/athena-webapp/src/components/services/ServiceIntakeView.tsx`
- Modify: `packages/athena-webapp/src/components/pos/CashierAuthDialog.tsx`
- Modify: `packages/athena-webapp/convex/operations/serviceIntake.ts`
- Modify: `packages/athena-webapp/convex/operations/staffCredentials.ts`
- Modify: `graphify-out/graph.json`
- Modify: `graphify-out/GRAPH_REPORT.md`

- [ ] **Step 1: Run the focused verification suite**

Run:

```bash
cd /Users/kwamina/athena/packages/athena-webapp && bun run test -- \
  shared/commandResult.test.ts \
  src/lib/errors/runCommand.test.ts \
  src/components/auth/DefaultCatchBoundary.test.tsx \
  convex/operations/serviceIntake.test.ts \
  convex/operations/staffCredentials.test.ts \
  src/components/services/ServiceIntakeView.test.tsx \
  src/components/services/ServiceIntakeView.auth.test.tsx \
  src/components/pos/CashierAuthDialog.test.tsx \
  src/routeTree.browser-boundary.test.ts
```

Expected: PASS with all foundation and proving-path tests green.

- [ ] **Step 2: Run the package smoke test**

Run: `cd /Users/kwamina/athena/packages/athena-webapp && bun run test -- src/tests/pos/simple.test.ts`

Expected: PASS so the new helpers do not destabilize the existing POS baseline.

- [ ] **Step 3: Rebuild graphify artifacts**

Run: `cd /Users/kwamina/athena && bun run graphify:rebuild`

Expected: PASS with `graphify-out/graph.json` and `graphify-out/GRAPH_REPORT.md` updated.

- [ ] **Step 4: Commit the verified foundation**

```bash
git add \
  /Users/kwamina/athena/packages/athena-webapp/shared/commandResult.ts \
  /Users/kwamina/athena/packages/athena-webapp/shared/commandResult.test.ts \
  /Users/kwamina/athena/packages/athena-webapp/src/lib/errors/runCommand.ts \
  /Users/kwamina/athena/packages/athena-webapp/src/lib/errors/runCommand.test.ts \
  /Users/kwamina/athena/packages/athena-webapp/src/lib/errors/presentCommandToast.ts \
  /Users/kwamina/athena/packages/athena-webapp/src/components/auth/DefaultCatchBoundary.tsx \
  /Users/kwamina/athena/packages/athena-webapp/src/components/auth/DefaultCatchBoundary.test.tsx \
  /Users/kwamina/athena/packages/athena-webapp/src/routes/__root.tsx \
  /Users/kwamina/athena/packages/athena-webapp/convex/operations/serviceIntake.ts \
  /Users/kwamina/athena/packages/athena-webapp/convex/operations/serviceIntake.test.ts \
  /Users/kwamina/athena/packages/athena-webapp/convex/operations/staffCredentials.ts \
  /Users/kwamina/athena/packages/athena-webapp/convex/operations/staffCredentials.test.ts \
  /Users/kwamina/athena/packages/athena-webapp/src/components/services/ServiceIntakeView.tsx \
  /Users/kwamina/athena/packages/athena-webapp/src/components/services/ServiceIntakeView.test.tsx \
  /Users/kwamina/athena/packages/athena-webapp/src/components/services/ServiceIntakeView.auth.test.tsx \
  /Users/kwamina/athena/packages/athena-webapp/src/components/pos/CashierAuthDialog.tsx \
  /Users/kwamina/athena/packages/athena-webapp/src/components/pos/CashierAuthDialog.test.tsx \
  /Users/kwamina/athena/packages/athena-webapp/src/lib/pos/application/results.ts \
  /Users/kwamina/athena/packages/athena-webapp/src/lib/pos/toastService.ts \
  /Users/kwamina/athena/graphify-out/graph.json \
  /Users/kwamina/athena/graphify-out/GRAPH_REPORT.md
git commit -m "feat: add client server error foundation"
```

## Self-Review

### Spec Coverage

- Shared command contract: covered by Tasks 1, 4, and 5.
- Client normalization and generic unexpected-error handling: covered by Tasks 2 and 3.
- Inline-by-default handling: covered by Task 6.
- Toast fallback: covered by Task 7.
- Generic global resilience layer: covered by Task 2.
- Migration path and verification: covered by Task 8.

### Placeholder Scan

- No `TODO`, `TBD`, or “implement later” placeholders remain.
- Each task names concrete files and commands.
- Each code-edit step includes actual code to start from.

### Type Consistency

- Shared `CommandResult<T>` and `UserError` live in `packages/athena-webapp/shared/commandResult.ts`.
- Client helpers consume `CommandResult<T>` instead of inventing a second surface contract.
- Server mutations return `ok(...)` and `userError(...)` from the same shared module.
