import { CustomerInfoPanel } from "../CustomerInfoPanel";
import type { RegisterCustomerPanelState } from "@/lib/pos/presentation/register/registerUiState";

interface RegisterCustomerPanelProps {
  customerPanel: RegisterCustomerPanelState;
}

export function RegisterCustomerPanel({
  customerPanel,
}: RegisterCustomerPanelProps) {
  return (
    <CustomerInfoPanel
      isOpen={customerPanel.isOpen}
      onOpenChange={customerPanel.onOpenChange}
      customerInfo={customerPanel.customerInfo}
      onCustomerCommitted={customerPanel.onCustomerCommitted}
      setCustomerInfo={customerPanel.setCustomerInfo}
    />
  );
}
