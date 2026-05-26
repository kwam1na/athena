import type {
  RegisterCheckoutState,
} from "@/lib/pos/presentation/register/registerUiState";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { getOrigin } from "~/src/lib/navigationUtils";
import type { Id } from "~/convex/_generated/dataModel";

import { OrderSummary } from "../OrderSummary";

interface RegisterCheckoutPanelProps {
  checkout: RegisterCheckoutState;
  onPaymentFlowChange?: (isActive: boolean) => void;
  onPaymentEntryStart?: () => void;
  onEditingPaymentChange?: (isEditing: boolean) => void;
  hidePaymentItemCountSummary?: boolean;
  hideActiveSummaryCards?: boolean;
  paymentsExpanded?: boolean;
  onPaymentsExpandedChange?: (isExpanded: boolean) => void;
}

export function RegisterCheckoutPanel({
  checkout,
  onPaymentFlowChange,
  onPaymentEntryStart,
  onEditingPaymentChange,
  hidePaymentItemCountSummary = false,
  hideActiveSummaryCards = false,
  paymentsExpanded,
  onPaymentsExpandedChange,
}: RegisterCheckoutPanelProps) {
  const navigate = useNavigate();
  const completedTransactionId = checkout.completedTransactionData
    ?.transactionId as Id<"posTransaction"> | undefined;
  const handleVoidTransaction = useCallback(() => {
    if (!completedTransactionId) {
      return;
    }

    void navigate({
      to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId",
      params: (current) => ({
        orgUrlSlug: current.orgUrlSlug!,
        storeUrlSlug: current.storeUrlSlug!,
        transactionId: completedTransactionId,
      }),
      search: { o: getOrigin() },
    });
  }, [completedTransactionId, navigate]);

  return (
    <div className="scrollbar-hide flex h-full min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain pr-1">
      <OrderSummary
        cartItems={checkout.cartItems}
        registerNumber={checkout.registerNumber}
        subtotal={checkout.subtotal}
        tax={checkout.tax}
        total={checkout.total}
        payments={checkout.payments}
        hasTerminal={checkout.hasTerminal}
        isTransactionCompleted={checkout.isTransactionCompleted}
        completedOrderNumber={checkout.completedOrderNumber}
        completedTransactionData={checkout.completedTransactionData}
        cashierName={checkout.cashierName}
        actorStaffProfileId={checkout.actorStaffProfileId}
        onAddPayment={checkout.onAddPayment}
        onUpdatePayment={checkout.onUpdatePayment}
        onRemovePayment={checkout.onRemovePayment}
        onClearPayments={checkout.onClearPayments}
        onCompleteTransaction={checkout.onCompleteTransaction}
        onStartNewTransaction={checkout.onStartNewTransaction}
        onVoidTransaction={
          completedTransactionId ? handleVoidTransaction : undefined
        }
        onPaymentFlowChange={onPaymentFlowChange}
        onPaymentEntryStart={onPaymentEntryStart}
        onEditingPaymentChange={onEditingPaymentChange}
        hidePaymentItemCountSummary={hidePaymentItemCountSummary}
        hideActiveSummaryCards={hideActiveSummaryCards}
        paymentsExpanded={paymentsExpanded}
        onPaymentsExpandedChange={onPaymentsExpandedChange}
      />
    </div>
  );
}
