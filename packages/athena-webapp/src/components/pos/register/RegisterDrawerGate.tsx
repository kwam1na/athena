import type { FormEvent } from "react";
import { ArrowRightIcon, Clock3Icon, LogOutIcon } from "lucide-react";
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
  variant?: "default" | "ghost";
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
    return "text-stone-900";
  }

  return variance > 0 ? "text-emerald-700" : "text-red-700";
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

  if (isOpeningFloatCorrection) {
    const currency = drawerGate.currency ?? "GHS";

    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-stone-200 bg-white p-8 shadow-sm">
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold text-stone-900">
            Correct opening float
          </h2>
          <p className="text-sm text-stone-600">
            Update the starting cash for register {drawerGate.registerNumber}.
            This adjusts expected cash and records an audit event.
          </p>
        </div>

        <form
          className="mt-8 space-y-5"
          onSubmit={handleOpeningFloatCorrectionSubmit}
        >
          <div className="rounded-lg border border-stone-200 bg-stone-50/70 p-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="space-y-1">
                <dt className="text-[11px] uppercase tracking-[0.16em] text-stone-500">
                  Current float
                </dt>
                <dd className="font-mono text-stone-900">
                  {formatCurrency(currency, drawerGate.currentOpeningFloat)}
                </dd>
              </div>
              <div className="space-y-1">
                <dt className="text-[11px] uppercase tracking-[0.16em] text-stone-500">
                  Expected cash
                </dt>
                <dd className="font-mono text-stone-900">
                  {formatCurrency(currency, drawerGate.expectedCash)}
                </dd>
              </div>
            </dl>
          </div>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-stone-700">
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
            <span className="text-sm font-medium text-stone-700">Reason</span>
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
            <p className="text-sm text-red-600" role="alert">
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
    const isPendingCloseoutApproval = Boolean(
      drawerGate.hasPendingCloseoutApproval,
    );
    const closeoutNotesRequired =
      drawerGate.closeoutDraftVariance !== undefined &&
      drawerGate.closeoutDraftVariance !== 0;

    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-stone-200 bg-white p-8 shadow-sm">
        {isPendingCloseoutApproval ? (
          <div className="space-y-8">
            <div className="flex flex-wrap items-start gap-5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
                <Clock3Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1 space-y-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-amber-800">
                  Manager approval required
                </p>
                <div className="space-y-2">
                  <h2 className="text-2xl font-semibold text-stone-900">
                    Register {drawerGate.registerNumber} closeout submitted
                  </h2>
                  <p className="max-w-xl text-sm leading-6 text-stone-600">
                    Waiting for manager review. Selling is paused until the
                    variance is approved or the register is reopened.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-5">
              <dl className="grid gap-4 text-sm sm:grid-cols-3">
                <div className="space-y-1">
                  <dt className="text-[11px] uppercase tracking-[0.16em] text-stone-500">
                    Expected
                  </dt>
                  <dd className="font-mono text-stone-900">
                    {formatCurrency(currency, drawerGate.expectedCash)}
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-[11px] uppercase tracking-[0.16em] text-stone-500">
                    Counted
                  </dt>
                  <dd className="font-mono text-stone-900">
                    {formatCurrency(
                      currency,
                      drawerGate.closeoutSubmittedCountedCash,
                    )}
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-[11px] uppercase tracking-[0.16em] text-stone-500">
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
              {drawerGate.canOpenCashControls ? (
                <CashControlsButton
                  className="w-full sm:w-auto"
                  registerSessionId={drawerGate.cashControlsRegisterSessionId}
                  variant="default"
                />
              ) : null}

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
            </div>

            {drawerGate.errorMessage ? (
              <p className="text-sm text-red-600" role="alert">
                {drawerGate.errorMessage}
              </p>
            ) : null}
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <h2 className="text-2xl font-semibold text-stone-900">
                Register {drawerGate.registerNumber} closeout in progress
              </h2>
              <p className="text-sm text-stone-600">
                Finish this register closeout in Cash Controls before selling
                here.
              </p>
            </div>

            <form className="mt-8 space-y-5" onSubmit={handleCloseoutSubmit}>
              <div className="rounded-lg border border-stone-200 bg-stone-50/70 p-4">
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div className="space-y-1">
                    <dt className="text-[11px] uppercase tracking-[0.16em] text-stone-500">
                      Expected
                    </dt>
                    <dd className="font-mono text-stone-900">
                      {formatCurrency(currency, drawerGate.expectedCash)}
                    </dd>
                  </div>
                  <div className="space-y-1">
                    <dt className="text-[11px] uppercase tracking-[0.16em] text-stone-500">
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
                <span className="text-sm font-medium text-stone-700">
                  Counted cash ({currencyDisplaySymbol(currency)})
                </span>
                <Input
                  autoFocus
                  disabled={drawerGate.isCloseoutSubmitting}
                  inputMode="decimal"
                  onChange={(event) =>
                    drawerGate.onCloseoutCountedCashChange?.(
                      event.target.value,
                    )
                  }
                  placeholder="0.00"
                  value={drawerGate.closeoutCountedCash ?? ""}
                />
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-stone-700">
                  Closeout notes
                </span>
                <Textarea
                  aria-required={closeoutNotesRequired}
                  disabled={drawerGate.isCloseoutSubmitting}
                  onChange={(event) =>
                    drawerGate.onCloseoutNotesChange?.(event.target.value)
                  }
                  placeholder="Add drawer notes if anything needs follow-up."
                  required={closeoutNotesRequired}
                  rows={3}
                  value={drawerGate.closeoutNotes ?? ""}
                />
                {closeoutNotesRequired ? (
                  <p className="text-xs text-stone-500">
                    Notes are required when the count has variance.
                  </p>
                ) : null}
              </label>

              {drawerGate.errorMessage ? (
                <p className="text-sm text-red-600" role="alert">
                  {drawerGate.errorMessage}
                </p>
              ) : null}

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <LoadingButton
                  className="w-full sm:w-auto"
                  disabled={Boolean(drawerGate.isCloseoutSubmitting)}
                  isLoading={Boolean(drawerGate.isCloseoutSubmitting)}
                  type="submit"
                >
                  Submit closeout
                </LoadingButton>

                <LoadingButton
                  className="w-full sm:w-auto"
                  disabled={Boolean(
                    drawerGate.isCloseoutSubmitting ||
                      drawerGate.isReopeningCloseout,
                  )}
                  isLoading={Boolean(drawerGate.isReopeningCloseout)}
                  onClick={() => void drawerGate.onReopenRegister?.()}
                  type="button"
                  variant="outline"
                >
                  {drawerGate.closeoutSecondaryActionLabel ??
                    "Reopen register"}
                </LoadingButton>

                {drawerGate.canOpenCashControls ? (
                  <CashControlsButton
                    className="w-full sm:w-auto"
                    registerSessionId={drawerGate.cashControlsRegisterSessionId}
                  />
                ) : null}

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
              </div>
            </form>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl rounded-lg border border-stone-200 bg-white p-8 shadow-sm">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-stone-500">
            Register {drawerGate.registerNumber}
          </p>
          <span className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs font-medium text-stone-600">
            Drawer closed
          </span>
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold text-stone-900">
            {isRecovery
              ? "Open drawer to continue"
              : "Open drawer to start selling"}
          </h2>
          <p className="text-sm leading-6 text-stone-600">
            {isRecovery
              ? `${drawerGate.registerLabel} is closed. Open the drawer to continue this sale.`
              : `${drawerGate.registerLabel} is closed. Enter the opening float before starting sales.`}
          </p>
        </div>
      </div>

      <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
        <label className="block space-y-2">
          <span className="text-sm font-medium text-stone-700">
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
          <span className="text-sm font-medium text-stone-700">
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
          <p className="text-sm text-red-600" role="alert">
            {drawerGate.errorMessage}
          </p>
        ) : drawerGate.canOpenDrawer === false ? (
          <p className="text-sm text-stone-600">
            Manager sign-in required to open this drawer.
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
