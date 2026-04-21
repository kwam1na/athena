import type {
  RegisterCashierCardState,
  RegisterCheckoutState,
} from "@/lib/pos/presentation/register/registerUiState";

import { CashierView } from "../CashierView";
import { OrderSummary } from "../OrderSummary";

interface RegisterCheckoutPanelProps {
  checkout: RegisterCheckoutState;
  cashierCard: RegisterCashierCardState | null;
}

export function RegisterCheckoutPanel({
  checkout,
  cashierCard,
}: RegisterCheckoutPanelProps) {
  return (
    <div className="space-y-6">
      <OrderSummary
        cartItems={checkout.cartItems}
        customerInfo={checkout.customerInfo}
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
        onAddPayment={checkout.onAddPayment}
        onUpdatePayment={checkout.onUpdatePayment}
        onRemovePayment={checkout.onRemovePayment}
        onClearPayments={checkout.onClearPayments}
        onCompleteTransaction={checkout.onCompleteTransaction}
        onStartNewTransaction={checkout.onStartNewTransaction}
      />

      {!checkout.isTransactionCompleted && cashierCard && (
        <CashierView
          cashierName={cashierCard.cashierName}
          onSignOut={cashierCard.onSignOut}
        />
      )}
    </div>
  );
}
