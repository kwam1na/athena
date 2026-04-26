import type { RegisterCustomerPanelState } from "@/lib/pos/presentation/register/registerUiState";
import { RegisterCustomerAttribution } from "./RegisterCustomerAttribution";

interface RegisterCustomerPanelProps {
  customerPanel: RegisterCustomerPanelState;
}

export function RegisterCustomerPanel({
  customerPanel,
}: RegisterCustomerPanelProps) {
  return (
    <RegisterCustomerAttribution
      customerInfo={customerPanel.customerInfo}
      onCustomerCommitted={customerPanel.onCustomerCommitted}
      setCustomerInfo={customerPanel.setCustomerInfo}
    />
  );
}
