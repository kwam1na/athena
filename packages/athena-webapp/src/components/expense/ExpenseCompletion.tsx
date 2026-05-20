import { Button } from "@/components/ui/button";
import { CartItem } from "../pos/types";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { currencyFormatter } from "~/convex/utils";
import { toDisplayAmount } from "~/convex/lib/currency";
import { Check, Printer } from "lucide-react";

interface ExpenseCompletionProps {
  cartItems: CartItem[];
  totalValue: number;
  notes: string;
  onNotesChange: (notes: string) => void;
  onComplete: () => void;
  isCompleting: boolean;
  isCompleted: boolean;
  completedTransactionData?: {
    completedAt: Date;
    cartItems: CartItem[];
    totalValue: number;
    notes?: string | null;
  } | null;
  reportNumber?: string | null;
  onPrintReceipt?: () => void | Promise<void>;
  onTransactionStateChange?: (isCompleted: boolean) => void;
}

export function ExpenseCompletion({
  cartItems,
  totalValue,
  onComplete,
  isCompleting,
  isCompleted,
  completedTransactionData,
  reportNumber,
  onPrintReceipt,
  onTransactionStateChange,
}: ExpenseCompletionProps) {
  const { activeStore } = useGetActiveStore();
  const formatter = currencyFormatter(activeStore?.currency || "GHS");

  if (isCompleted && completedTransactionData) {
    const itemCount = completedTransactionData.cartItems.reduce(
      (sum, item) => sum + item.quantity,
      0,
    );

    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="rounded-lg border border-[hsl(var(--success)/0.24)] bg-[hsl(var(--success)/0.08)] p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--success))] text-[hsl(var(--success-foreground))]">
              <Check className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[hsl(var(--success))]">
                Expense recorded
              </p>
              <h3 className="mt-1 text-xl font-semibold text-foreground">
                Receipt ready
              </h3>
              {reportNumber ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  Report #{reportNumber}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="grid gap-3">
          <div className="rounded-lg border border-border bg-surface-raised p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Total value
            </p>
            <p className="mt-2 text-3xl font-bold text-foreground">
              {formatter.format(
                toDisplayAmount(completedTransactionData.totalValue),
              )}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border bg-surface-raised p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Items
              </p>
              <p className="mt-2 text-lg font-semibold text-foreground">
                {itemCount}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-surface-raised p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Printed
              </p>
              <p className="mt-2 text-lg font-semibold text-foreground">
                Ready
              </p>
            </div>
          </div>
        </div>

        <div className="mt-auto grid gap-3">
          <Button
            type="button"
            onClick={onPrintReceipt}
            disabled={!onPrintReceipt}
            className="w-full gap-2"
            variant="outline"
            size="lg"
          >
            <Printer className="h-4 w-4" />
            Print receipt
          </Button>
          <Button
            onClick={() => {
              onTransactionStateChange?.(false);
              onComplete();
            }}
            className="w-full bg-signal p-8 text-signal-foreground hover:bg-signal/90 hover:text-signal-foreground"
            variant="outline"
            size="lg"
          >
            Start new expense
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-24">
        <div className="p-4 bg-gray-50 rounded-lg">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium text-gray-700">
              Total Value
            </span>
            <span className="text-4xl font-bold text-gray-900">
              {formatter.format(toDisplayAmount(totalValue))}
            </span>
          </div>
          {/* <p className="text-xs text-gray-500 mt-1">
            {cartItems.length} item{cartItems.length !== 1 ? "s" : ""}
          </p> */}
        </div>

        {/* <div className="space-y-2">
          <Label htmlFor="expense-notes">Notes (Optional)</Label>
          <Textarea
            id="expense-notes"
            placeholder="Enter reason for expense..."
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            rows={4}
            className="resize-none"
          />
        </div> */}

        <Button
          onClick={onComplete}
          disabled={!isCompleted && (isCompleting || cartItems.length === 0)}
          className="w-full p-8 bg-green-500 text-white hover:text-white hover:bg-green-600"
          variant="outline"
          size="lg"
        >
          {isCompleted
            ? "Start new expense"
            : isCompleting
              ? "Recording expense..."
              : "Complete expense"}
        </Button>

      </div>
    </div>
  );
}
