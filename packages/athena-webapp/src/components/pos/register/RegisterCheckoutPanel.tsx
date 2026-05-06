import type {
  RegisterCashierCardState,
  RegisterCheckoutState,
} from "@/lib/pos/presentation/register/registerUiState";

import { CashierView } from "../CashierView";
import { OrderSummary } from "../OrderSummary";

interface RegisterCheckoutPanelProps {
  checkout: RegisterCheckoutState;
  cashierCard: RegisterCashierCardState | null;
  onPaymentFlowChange?: (isActive: boolean) => void;
  onPaymentEntryStart?: () => void;
  onEditingPaymentChange?: (isEditing: boolean) => void;
  hidePaymentItemCountSummary?: boolean;
  paymentsExpanded?: boolean;
  onPaymentsExpandedChange?: (isExpanded: boolean) => void;
}

export function RegisterCheckoutPanel({
  checkout,
  cashierCard,
  onPaymentFlowChange,
  onPaymentEntryStart,
  onEditingPaymentChange,
  hidePaymentItemCountSummary = false,
  paymentsExpanded,
  onPaymentsExpandedChange,
}: RegisterCheckoutPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-6">
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
        onPaymentFlowChange={onPaymentFlowChange}
        onPaymentEntryStart={onPaymentEntryStart}
        onEditingPaymentChange={onEditingPaymentChange}
        hidePaymentItemCountSummary={hidePaymentItemCountSummary}
        paymentsExpanded={paymentsExpanded}
        onPaymentsExpandedChange={onPaymentsExpandedChange}
      />

      {!checkout.isTransactionCompleted && (
        <div className="shrink-0">
          <CashierView
            cashierName={cashierCard?.cashierName ?? "Unassigned"}
            isSignInRequired={!cashierCard}
            onSignOut={cashierCard?.onSignOut}
          />
        </div>
      )}
    </div>
  );
}
