import { SessionManager } from "../SessionManager";
import type { RegisterSessionPanelState } from "@/lib/pos/presentation/register/registerUiState";

interface RegisterSessionPanelProps {
  sessionPanel: RegisterSessionPanelState | null;
}

export function RegisterSessionPanel({
  sessionPanel,
}: RegisterSessionPanelProps) {
  if (!sessionPanel) {
    return null;
  }

  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg border">
      <SessionManager
        key={`session-manager-${sessionPanel.registerNumber}-${sessionPanel.terminalId}-${sessionPanel.cashierId}`}
        storeId={sessionPanel.storeId}
        terminalId={sessionPanel.terminalId}
        cashierId={sessionPanel.cashierId}
        registerNumber={sessionPanel.registerNumber}
        cartItems={sessionPanel.cartItems}
        customerInfo={sessionPanel.customerInfo}
        subtotal={sessionPanel.subtotal}
        tax={sessionPanel.tax}
        total={sessionPanel.total}
        onSessionLoaded={sessionPanel.onSessionLoaded}
        onNewSession={sessionPanel.onNewSession}
        resetAutoSessionInitialized={sessionPanel.resetAutoSessionInitialized}
      />
    </div>
  );
}
