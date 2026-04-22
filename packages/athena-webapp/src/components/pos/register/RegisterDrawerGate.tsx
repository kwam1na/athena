import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { RegisterDrawerGateState } from "@/lib/pos/presentation/register/registerUiState";

export function RegisterDrawerGate({
  drawerGate,
}: {
  drawerGate: RegisterDrawerGateState;
}) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void drawerGate.onSubmit();
  };

  return (
    <div className="mx-auto max-w-2xl rounded-3xl border border-stone-200 bg-white p-8 shadow-sm">
      <div className="space-y-3">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-stone-500">
          Drawer setup
        </p>
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold text-stone-900">
            Open drawer before selling
          </h2>
          <p className="text-sm text-stone-600">
            {drawerGate.registerLabel} must have an active cash drawer before POS
            can start or resume a live session.
          </p>
          <p className="text-sm text-stone-500">
            Register {drawerGate.registerNumber}
          </p>
        </div>
      </div>

      <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
        <label className="block space-y-2">
          <span className="text-sm font-medium text-stone-700">
            Opening float ({drawerGate.currency})
          </span>
          <Input
            autoFocus
            disabled={drawerGate.isSubmitting}
            inputMode="decimal"
            onChange={(event) =>
              drawerGate.onOpeningFloatChange(event.target.value)
            }
            placeholder="0.00"
            value={drawerGate.openingFloat}
          />
        </label>

        <label className="block space-y-2">
          <span className="text-sm font-medium text-stone-700">
            Notes (optional)
          </span>
          <Textarea
            disabled={drawerGate.isSubmitting}
            onChange={(event) => drawerGate.onNotesChange(event.target.value)}
            placeholder="Add a quick note for this drawer opening"
            rows={4}
            value={drawerGate.notes}
          />
        </label>

        {drawerGate.errorMessage ? (
          <p className="text-sm text-red-600" role="alert">
            {drawerGate.errorMessage}
          </p>
        ) : null}

        <Button
          className="w-full sm:w-auto"
          disabled={drawerGate.isSubmitting}
          type="submit"
        >
          {drawerGate.isSubmitting ? "Opening drawer..." : "Open drawer"}
        </Button>
      </form>
    </div>
  );
}
