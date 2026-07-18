import { Button } from "@/components/ui/button";
import { CartItem } from "../pos/types";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { currencyFormatter } from "~/convex/utils";
import { toDisplayAmount } from "~/convex/lib/currency";
import { Check, Plus, Printer } from "lucide-react";

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
  recordedBy?: string | null;
  onPrintReceipt?: () => void | Promise<void>;
  onTransactionStateChange?: (isCompleted: boolean) => void;
}

export function ExpenseCompletion({
  cartItems,
  onComplete,
  isCompleting,
  isCompleted,
  completedTransactionData,
  reportNumber,
  recordedBy,
  onPrintReceipt,
  onTransactionStateChange,
}: ExpenseCompletionProps) {
  const { activeStore } = useGetActiveStore();
  const formatter = currencyFormatter(activeStore?.currency || "GHS");
  const hasReportNumber = Boolean(reportNumber?.trim());

  if (isCompleted && completedTransactionData) {
    const itemCount = completedTransactionData.cartItems.reduce(
      (sum, item) => sum + item.quantity,
      0,
    );

    return (
      <section className="relative flex h-full min-h-[36rem] flex-1 flex-col overflow-hidden rounded-[1.75rem] border border-border/80 bg-[linear-gradient(145deg,hsl(var(--surface-raised))_0%,hsl(var(--surface))_52%,hsl(var(--muted)/0.72)_100%)] p-8 shadow-[var(--shadow-surface)] md:p-10">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent"
        />

        <div className="flex flex-1 flex-col">
          <div className="space-y-10">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-[1.4rem] bg-[hsl(var(--success))] text-[hsl(var(--success-foreground))] shadow-[0_20px_40px_-24px_hsl(var(--success)/0.75)] animate-[presence-lift_var(--motion-standard)_var(--ease-emphasized)_both]">
              <Check className="h-7 w-7" />
            </div>

            <div className="max-w-2xl space-y-4">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">
                Expense complete
              </p>
              <h2 className="text-3xl font-semibold tracking-tight text-foreground md:text-[3rem]">
                Ready for next expense
              </h2>
            </div>
          </div>

          <div className="mt-auto space-y-5">
            <div
              className={`grid gap-3 md:gap-4 ${
                hasReportNumber ? "md:grid-cols-4" : "md:grid-cols-3"
              }`}
            >
              <div className="rounded-lg border border-border/70 bg-surface-raised p-4 backdrop-blur-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Total value
                </p>
                <p className="mt-3 text-2xl font-semibold text-foreground">
                  {formatter.format(
                    toDisplayAmount(completedTransactionData.totalValue),
                  )}
                </p>
              </div>
              <div className="rounded-lg border border-border/70 bg-surface-raised p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Items
                </p>
                <p className="mt-3 text-2xl font-semibold text-foreground">
                  {itemCount}
                </p>
              </div>
              {hasReportNumber ? (
                <div className="rounded-lg border border-border/70 bg-surface-raised p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    Report
                  </p>
                  <p className="mt-3 truncate text-sm font-medium text-foreground">
                    #{reportNumber}
                  </p>
                </div>
              ) : null}
              <div className="rounded-lg border border-border/70 bg-surface-raised p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Recorded by
                </p>
                <p className="mt-3 truncate text-sm font-medium text-foreground">
                  {recordedBy ?? "Unassigned"}
                </p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Button
                type="button"
                onClick={onPrintReceipt}
                disabled={!onPrintReceipt}
                className="h-14 rounded-2xl px-5 text-sm font-semibold"
                variant="utility-strong"
              >
                <Printer className="h-4 w-4" />
                Print receipt
              </Button>
              <Button
                type="button"
                onClick={() => {
                  onTransactionStateChange?.(false);
                  onComplete();
                }}
                className="h-14 rounded-2xl border-border bg-background px-5 text-sm font-semibold"
                variant="outline"
              >
                <Plus className="h-4 w-4" />
                Start new expense
              </Button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <Button
      onClick={onComplete}
      disabled={!isCompleted && (isCompleting || cartItems.length === 0)}
      className="h-20 w-full rounded-xl bg-success px-6 text-base font-semibold text-success-foreground shadow-sm hover:bg-success/90 hover:text-success-foreground"
      size="lg"
    >
      {isCompleted
        ? "Start new expense"
        : isCompleting
          ? "Recording expense..."
          : "Complete expense"}
    </Button>
  );
}
