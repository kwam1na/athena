import type { RegisterCustomerPanelState } from "@/lib/pos/presentation/register/registerUiState";
import { RegisterCustomerAttribution } from "./RegisterCustomerAttribution";

interface RegisterCustomerPanelProps {
  customerPanel: RegisterCustomerPanelState;
  disabled?: boolean;
}

export function RegisterCustomerPanel({
  customerPanel,
  disabled,
}: RegisterCustomerPanelProps) {
  return (
    <RegisterCustomerAttribution
      customerInfo={customerPanel.customerInfo}
      isOpen={customerPanel.isOpen}
      onOpenChange={customerPanel.onOpenChange}
      onCustomerCommitted={customerPanel.onCustomerCommitted}
      setCustomerInfo={customerPanel.setCustomerInfo}
      disabled={disabled}
    />
  );
}
