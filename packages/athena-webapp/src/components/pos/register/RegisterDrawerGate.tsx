import type { FormEvent } from "react";
import { ArrowRightIcon, LogOutIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { RegisterDrawerGateState } from "@/lib/pos/presentation/register/registerUiState";
import { getOrigin } from "~/src/lib/navigationUtils";
import { currencyDisplaySymbol } from "~/shared/currencyFormatter";

function CashControlsButton({
  className,
  variant = "ghost",
}: {
  className?: string;
  variant?: "default" | "ghost";
}) {
  return (
    <Button asChild className={className} type="button" variant={variant}>
      <Link
        className="inline-flex items-center justify-center"
        params={(params) => ({
          ...params,
          orgUrlSlug: params.orgUrlSlug!,
          storeUrlSlug: params.storeUrlSlug!,
        })}
        search={{
          o: getOrigin(),
        }}
        to="/$orgUrlSlug/store/$storeUrlSlug/cash-controls"
      >
        Cash controls
        <ArrowRightIcon className="ml-2 h-4 w-4" />
      </Link>
    </Button>
  );
}

export function RegisterDrawerGate({
  drawerGate,
}: {
  drawerGate: RegisterDrawerGateState;
}) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void drawerGate.onSubmit?.();
  };
  const isCloseoutBlocked = drawerGate.mode === "closeoutBlocked";
  const isRecovery = drawerGate.mode === "recovery";

  if (isCloseoutBlocked) {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-stone-200 bg-white p-8 shadow-sm">
        <div className="space-y-3">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-stone-500">
            Register closeout
          </p>
          <div className="space-y-1">
            <h2 className="text-2xl font-semibold text-stone-900">
              Closeout in progress
            </h2>
            <p className="text-sm text-stone-600">
              {drawerGate.registerLabel} is already in closeout. Finish it in
              Cash Controls before selling here again.
            </p>
            <p className="text-sm text-stone-500">
              Register {drawerGate.registerNumber}
            </p>
          </div>
        </div>

        {drawerGate.errorMessage ? (
          <p className="mt-6 text-sm text-red-600" role="alert">
            {drawerGate.errorMessage}
          </p>
        ) : null}

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <CashControlsButton className="w-full sm:w-auto" variant="default" />

          <Button
            className="w-full sm:w-auto"
            onClick={() => void drawerGate.onSignOut()}
            type="button"
            variant="outline"
          >
            <LogOutIcon className="mr-2 h-4 w-4" />
            Sign out
          </Button>
        </div>
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
            Opening float ({currencyDisplaySymbol(drawerGate.currency ?? "GHS")})
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
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button
            className="w-full sm:w-auto"
            disabled={drawerGate.isSubmitting}
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

          <CashControlsButton className="w-full sm:w-auto" />
        </div>
      </form>
    </div>
  );
}
