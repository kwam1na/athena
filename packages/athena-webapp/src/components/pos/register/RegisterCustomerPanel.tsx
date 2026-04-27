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
      onCustomerCommitted={customerPanel.onCustomerCommitted}
      setCustomerInfo={customerPanel.setCustomerInfo}
      disabled={disabled}
    />
  );
}
