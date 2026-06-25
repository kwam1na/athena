import type { FormEvent } from "react";
import {
  ArrowRightIcon,
  Clock3Icon,
  LogOutIcon,
  RefreshCwIcon,
} from "lucide-react";
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingButton } from "@/components/ui/loading-button";
import { Textarea } from "@/components/ui/textarea";
import { formatStoredAmount } from "@/lib/pos/displayAmounts";
import type { RegisterDrawerGateState } from "@/lib/pos/presentation/register/registerUiState";
import { getOrigin } from "~/src/lib/navigationUtils";
import {
  currencyDisplaySymbol,
  currencyFormatter,
} from "~/shared/currencyFormatter";

function CashControlsButton({
  className,
  registerSessionId,
  variant = "ghost",
}: {
  className?: string;
  registerSessionId?: string;
  variant?: "default" | "ghost" | "workflow";
}) {
  return (
    <Button asChild className={className} type="button" variant={variant}>
      <Link
        className="inline-flex items-center justify-center"
        params={(params) => ({
          ...params,
          orgUrlSlug: params.orgUrlSlug!,
          ...(registerSessionId ? { sessionId: registerSessionId } : {}),
          storeUrlSlug: params.storeUrlSlug!,
        })}
        search={{
          o: getOrigin(),
        }}
        to={
          registerSessionId
            ? "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId"
            : "/$orgUrlSlug/store/$storeUrlSlug/cash-controls"
        }
      >
        Cash controls
        <ArrowRightIcon className="ml-2 h-4 w-4" />
      </Link>
    </Button>
  );
}

function formatCurrency(currency: string, amount?: number | null) {
  if (amount === undefined || amount === null) {
    return "Pending";
  }

  return formatStoredAmount(currencyFormatter(currency), amount);
}

function getVarianceTone(variance?: number) {
  if (variance === undefined || variance === 0) {
    return "text-foreground";
  }

  return variance > 0 ? "text-success" : "text-danger";
}

function RegisterSessionCode({
  code,
  scope,
}: {
  code?: string;
  scope?: "cloud" | "local";
}) {
  if (!code) {
    return null;
  }

  const label = scope === "local" ? "Local session" : "Cloud session";

  return (
    <p className="text-xs leading-5 text-muted-foreground/80">
      {label}{" "}
      <span className="font-mono text-foreground/65">{code}</span>
    </p>
  );
}

function formatRegisterGateLabel({
  registerLabel,
  registerNumber,
}: {
  registerLabel?: string;
  registerNumber: string;
}) {
  const terminalName = registerLabel?.trim();
  const registerName = `Register ${registerNumber}`;

  return terminalName ? `${terminalName} / ${registerName}` : registerName;
}

export function RegisterDrawerGate({
  drawerGate,
}: {
  drawerGate: RegisterDrawerGateState;
}) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (drawerGate.canOpenDrawer === false) {
      return;
    }
    void drawerGate.onSubmit?.();
  };
  const handleSubmitButtonClick = () => {
    if (drawerGate.canOpenDrawer === false) {
      return;
    }
    void drawerGate.onSubmit?.();
  };
  const handleCloseoutSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void drawerGate.onSubmitCloseout?.();
  };
  const handleOpeningFloatCorrectionSubmit = (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    void drawerGate.onSubmitOpeningFloatCorrection?.();
  };
  const isCloseoutBlocked = drawerGate.mode === "closeoutBlocked";
  const isOpeningFloatCorrection = drawerGate.mode === "openingFloatCorrection";
  const isRecovery = drawerGate.mode === "recovery";
  const isAuthorityRepair =
    drawerGate.mode === "terminalRepair" ||
    drawerGate.mode === "drawerAuthorityRepair";
  const canSignOut = drawerGate.hasSignedInStaff !== false;

  if (isAuthorityRepair) {
    const isTerminalRepair = drawerGate.mode === "terminalRepair";

    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-border bg-surface-raised p-8 shadow-surface">
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Register {drawerGate.registerNumber}
            </p>
            <span className="rounded-full border border-warning/35 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning-foreground">
              Setup needed
            </span>
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold text-foreground">
              {isTerminalRepair
                ? "Terminal setup needs repair"
                : "Drawer needs repair"}
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              {isTerminalRepair
                ? `${drawerGate.registerLabel} cannot record new sales until terminal setup is repaired. Existing local activity is preserved for support.`
                : `${drawerGate.registerLabel} needs a current drawer before sales can continue. Existing local activity is preserved for support.`}
            </p>
            {drawerGate.errorMessage ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm leading-6 text-destructive">
                {drawerGate.errorMessage}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            {isTerminalRepair && drawerGate.onRepairTerminalSetup ? (
              <LoadingButton
                disabled={Boolean(drawerGate.isRepairingTerminalSetup)}
                isLoading={Boolean(drawerGate.isRepairingTerminalSetup)}
                type="button"
                variant="default"
                onClick={() => void drawerGate.onRepairTerminalSetup?.()}
              >
                <RefreshCwIcon className="mr-2 h-4 w-4" />
                {drawerGate.isRepairingTerminalSetup
                  ? "Repairing setup"
                  : "Repair setup"}
              </LoadingButton>
            ) : null}
            {!isTerminalRepair && drawerGate.onRetrySync ? (
              <Button
                type="button"
                variant="default"
                onClick={drawerGate.onRetrySync}
              >
                <RefreshCwIcon className="mr-2 h-4 w-4" />
                Retry sync
              </Button>
            ) : null}
            {canSignOut ? (
              <Button
                type="button"
                variant="outline"
                onClick={drawerGate.onSignOut}
              >
                <LogOutIcon className="mr-2 h-4 w-4" />
                Sign out
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  if (isOpeningFloatCorrection) {
    const currency = drawerGate.currency ?? "GHS";

    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-border bg-surface-raised p-8 shadow-surface">
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold text-foreground">
            Correct opening float
          </h2>
          <p className="text-sm text-muted-foreground">
            Update the starting cash for register {drawerGate.registerNumber}.
            This adjusts expected cash and records an audit event.
          </p>
        </div>

        <form
          className="mt-8 space-y-5"
          onSubmit={handleOpeningFloatCorrectionSubmit}
        >
          <div className="rounded-lg border border-border bg-surface p-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="space-y-1">
                <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  Current float
                </dt>
                <dd className="font-mono text-foreground">
                  {formatCurrency(currency, drawerGate.currentOpeningFloat)}
                </dd>
              </div>
              <div className="space-y-1">
                <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  Expected cash
                </dt>
                <dd className="font-mono text-foreground">
                  {formatCurrency(currency, drawerGate.expectedCash)}
                </dd>
              </div>
            </dl>
          </div>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-foreground">
              Corrected opening float ({currencyDisplaySymbol(currency)})
            </span>
            <Input
              autoFocus
              disabled={drawerGate.isCorrectingOpeningFloat}
              inputMode="decimal"
              onChange={(event) =>
                drawerGate.onCorrectedOpeningFloatChange?.(event.target.value)
              }
              placeholder="0.00"
              value={drawerGate.correctedOpeningFloat ?? ""}
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-foreground">Reason</span>
            <Textarea
              disabled={drawerGate.isCorrectingOpeningFloat}
              onChange={(event) =>
                drawerGate.onCorrectionReasonChange?.(event.target.value)
              }
              placeholder="Add why the opening float is being corrected."
              rows={3}
              value={drawerGate.correctionReason ?? ""}
            />
          </label>

          {drawerGate.errorMessage ? (
            <p className="text-sm text-danger" role="alert">
              {drawerGate.errorMessage}
            </p>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <LoadingButton
              className="w-full sm:w-auto"
              disabled={Boolean(drawerGate.isCorrectingOpeningFloat)}
              isLoading={Boolean(drawerGate.isCorrectingOpeningFloat)}
              type="submit"
            >
              Save correction
            </LoadingButton>

            <Button
              className="w-full sm:w-auto"
              disabled={drawerGate.isCorrectingOpeningFloat}
              onClick={drawerGate.onCancelOpeningFloatCorrection}
              type="button"
              variant="outline"
            >
              Return to sale
            </Button>

            <CashControlsButton className="w-full sm:w-auto" />
          </div>
        </form>
      </div>
    );
  }

  if (isCloseoutBlocked) {
    const currency = drawerGate.currency ?? "GHS";
    const closeoutSubmittedReason =
      drawerGate.closeoutSubmittedReason ??
      (drawerGate.hasPendingCloseoutApproval ? "manager_review" : null);
    const isSubmittedCloseout = Boolean(closeoutSubmittedReason);
    const isManagerReviewCloseout =
      closeoutSubmittedReason === "manager_review";
    const closeoutRegisterLabel = formatRegisterGateLabel({
      registerLabel: drawerGate.registerLabel,
      registerNumber: drawerGate.registerNumber,
    });

    return (
      <div className="mx-auto flex max-w-2xl flex-col rounded-lg border border-border bg-surface-raised p-8 shadow-surface">
        {isSubmittedCloseout ? (
          <div className="flex flex-col gap-8">
            <div className="flex flex-wrap items-start gap-5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning">
                <Clock3Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1 space-y-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-warning">
                  {isManagerReviewCloseout
                    ? "Manager approval required"
                    : "Closeout syncing"}
                </p>
                <div className="space-y-2">
                  <h2 className="text-2xl font-semibold text-foreground">
                    {closeoutRegisterLabel} closeout submitted
                  </h2>
                  <p className="max-w-xl text-sm leading-6 text-muted-foreground">
                    {isManagerReviewCloseout
                      ? "Waiting for manager review. Selling is paused until the variance is approved or the register is reopened."
                      : "Closeout is saved on this register. Selling is paused until sync finishes or the register is reopened."}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-warning/30 bg-warning/10 p-5">
              <dl className="grid gap-4 text-sm sm:grid-cols-3">
                <div className="space-y-1">
                  <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    Expected
                  </dt>
                  <dd className="font-mono text-foreground">
                    {formatCurrency(currency, drawerGate.expectedCash)}
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    Counted
                  </dt>
                  <dd className="font-mono text-foreground">
                    {formatCurrency(
                      currency,
                      drawerGate.closeoutSubmittedCountedCash,
                    )}
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    Variance
                  </dt>
                  <dd
                    className={`font-mono ${getVarianceTone(drawerGate.closeoutSubmittedVariance)}`}
                  >
                    {formatCurrency(
                      currency,
                      drawerGate.closeoutSubmittedVariance,
                    )}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              {drawerGate.onSubmit ? (
                <LoadingButton
                  className="w-full sm:w-auto"
                  disabled={
                    drawerGate.canOpenDrawer === false ||
                    Boolean(drawerGate.isSubmitting)
                  }
                  isLoading={Boolean(drawerGate.isSubmitting)}
                  onClick={handleSubmitButtonClick}
                  type="button"
                  variant="workflow"
                >
                  {drawerGate.closeoutSecondaryActionLabel ??
                    "Open replacement drawer"}
                </LoadingButton>
              ) : null}

              {drawerGate.canOpenCashControls ? (
                <CashControlsButton
                  className="w-full sm:w-auto"
                  registerSessionId={drawerGate.cashControlsRegisterSessionId}
                  variant="workflow"
                />
              ) : null}

              {drawerGate.onReopenRegister ? (
                <LoadingButton
                  className="w-full sm:w-auto"
                  disabled={Boolean(drawerGate.isReopeningCloseout)}
                  isLoading={Boolean(drawerGate.isReopeningCloseout)}
                  onClick={() => void drawerGate.onReopenRegister?.()}
                  type="button"
                  variant="outline"
                >
                  {drawerGate.closeoutSecondaryActionLabel ?? "Reopen register"}
                </LoadingButton>
              ) : null}

              {canSignOut ? (
                <Button
                  className="w-full sm:w-auto"
                  disabled={drawerGate.isReopeningCloseout}
                  onClick={() => void drawerGate.onSignOut()}
                  type="button"
                  variant="outline"
                >
                  <LogOutIcon className="mr-2 h-4 w-4" />
                  Sign out
                </Button>
              ) : null}
            </div>

            {drawerGate.errorMessage ? (
              <p className="text-sm text-danger" role="alert">
                {drawerGate.errorMessage}
              </p>
            ) : null}

            <div className="flex justify-end">
              <RegisterSessionCode
                code={drawerGate.registerSessionCode}
                scope={drawerGate.registerSessionCodeScope}
              />
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <h2 className="text-2xl font-semibold text-foreground">
                {closeoutRegisterLabel} closeout in progress
              </h2>
            </div>

            <form className="mt-8 space-y-5" onSubmit={handleCloseoutSubmit}>
              <div className="rounded-lg border border-border bg-surface p-4">
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div className="space-y-1">
                    <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                      Expected
                    </dt>
                    <dd className="font-mono text-foreground">
                      {formatCurrency(currency, drawerGate.expectedCash)}
                    </dd>
                  </div>
                  <div className="space-y-1">
                    <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                      Draft variance
                    </dt>
                    <dd
                      className={`font-mono ${getVarianceTone(drawerGate.closeoutDraftVariance)}`}
                    >
                      {drawerGate.closeoutDraftVariance === undefined
                        ? "Pending count"
                        : formatCurrency(
                          currency,
                          drawerGate.closeoutDraftVariance,
                        )}
                    </dd>
                  </div>
                </dl>
              </div>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-foreground">
                  Counted cash ({currencyDisplaySymbol(currency)})
                </span>
                <Input
                  autoFocus
                  disabled={drawerGate.isCloseoutSubmitting}
                  inputMode="decimal"
                  onChange={(event) =>
                    drawerGate.onCloseoutCountedCashChange?.(event.target.value)
                  }
                  placeholder="0.00"
                  value={drawerGate.closeoutCountedCash ?? ""}
                />
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-foreground">
                  Closeout notes
                </span>
                <Textarea
                  disabled={drawerGate.isCloseoutSubmitting}
                  onChange={(event) =>
                    drawerGate.onCloseoutNotesChange?.(event.target.value)
                  }
                  placeholder="Add drawer notes if anything needs follow-up."
                  rows={3}
                  value={drawerGate.closeoutNotes ?? ""}
                />
              </label>

              {drawerGate.errorMessage ? (
                <p className="text-sm text-danger" role="alert">
                  {drawerGate.errorMessage}
                </p>
              ) : null}

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <LoadingButton
                  className="w-full sm:w-auto"
                  variant={"workflow"}
                  disabled={Boolean(drawerGate.isCloseoutSubmitting)}
                  isLoading={Boolean(drawerGate.isCloseoutSubmitting)}
                  type="submit"
                >
                  Submit closeout
                </LoadingButton>

                {drawerGate.onCloseoutSecondaryAction ? (
                  <LoadingButton
                    className="w-full sm:w-auto"
                    disabled={Boolean(
                      drawerGate.isCloseoutSubmitting ||
                      drawerGate.isReopeningCloseout,
                    )}
                    isLoading={Boolean(drawerGate.isReopeningCloseout)}
                    onClick={() => void drawerGate.onCloseoutSecondaryAction?.()}
                    type="button"
                    variant="outline"
                  >
                    {drawerGate.closeoutSecondaryActionLabel ?? "Reopen register"}
                  </LoadingButton>
                ) : null}

                {drawerGate.canOpenCashControls ? (
                  <CashControlsButton
                    className="w-full sm:w-auto"
                    registerSessionId={drawerGate.cashControlsRegisterSessionId}
                  />
                ) : null}

                {canSignOut ? (
                  <Button
                    className="w-full sm:w-auto"
                    disabled={
                      drawerGate.isCloseoutSubmitting ||
                      drawerGate.isReopeningCloseout
                    }
                    onClick={() => void drawerGate.onSignOut()}
                    type="button"
                    variant="outline"
                  >
                    <LogOutIcon className="mr-2 h-4 w-4" />
                    Sign out
                  </Button>
                ) : null}
              </div>
            </form>

            <div className="mt-6 flex justify-end">
              <RegisterSessionCode
                code={drawerGate.registerSessionCode}
                scope={drawerGate.registerSessionCodeScope}
              />
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl rounded-lg border border-border bg-surface-raised p-8 shadow-surface">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Register {drawerGate.registerNumber}
          </p>
          <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium text-muted-foreground">
            Drawer closed
          </span>
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold text-foreground">
            {isRecovery
              ? "Open drawer to continue"
              : "Open drawer to start selling"}
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            {isRecovery
              ? `${drawerGate.registerLabel} is closed. Open the drawer to continue this sale.`
              : `${drawerGate.registerLabel} is closed. Enter the opening float before starting sales.`}
          </p>
        </div>
      </div>

      <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
        <label className="block space-y-2">
          <span className="text-sm font-medium text-foreground">
            Opening float ({currencyDisplaySymbol(drawerGate.currency ?? "GHS")}
            )
          </span>
          <Input
            autoFocus
            disabled={drawerGate.isSubmitting}
            inputMode="decimal"
            onChange={(event) =>
              drawerGate.onOpeningFloatChange?.(event.target.value)
            }
            placeholder="0.00"
            value={drawerGate.openingFloat ?? ""}
          />
        </label>

        <label className="block space-y-2">
          <span className="text-sm font-medium text-foreground">
            Notes (optional)
          </span>
          <Textarea
            disabled={drawerGate.isSubmitting}
            onChange={(event) => drawerGate.onNotesChange?.(event.target.value)}
            placeholder="Add a note for this drawer opening"
            rows={4}
            value={drawerGate.notes ?? ""}
          />
        </label>

        {drawerGate.errorMessage ? (
          <p className="text-sm text-danger" role="alert">
            {drawerGate.errorMessage}
          </p>
        ) : drawerGate.canOpenDrawer === false ? (
          <p className="text-sm text-muted-foreground">
            Cashier or manager sign-in required to open this drawer.
          </p>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button
            className="w-full sm:w-auto"
            disabled={
              drawerGate.isSubmitting || drawerGate.canOpenDrawer === false
            }
            type="submit"
          >
            {drawerGate.isSubmitting ? "Opening drawer" : "Open drawer"}
          </Button>

          {canSignOut ? (
            <Button
              className="w-full sm:w-auto"
              disabled={drawerGate.isSubmitting}
              onClick={() => void drawerGate.onSignOut()}
              type="button"
              variant="outline"
            >
              <LogOutIcon className="mr-2 h-4 w-4" />
              Sign out
            </Button>
          ) : null}

          {drawerGate.canOpenCashControls ? (
            <CashControlsButton
              className="w-full sm:w-auto"
              registerSessionId={drawerGate.cashControlsRegisterSessionId}
            />
          ) : null}
        </div>
      </form>
    </div>
  );
}
