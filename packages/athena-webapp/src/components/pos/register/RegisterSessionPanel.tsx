import { FadeIn } from "../../common/FadeIn";
import { SessionManager } from "../SessionManager";
import type { RegisterSessionPanelState } from "@/lib/pos/presentation/register/registerUiState";

interface RegisterSessionPanelProps {
  isSessionActive: boolean;
  sessionPanel: RegisterSessionPanelState | null;
}

export function RegisterSessionPanel({
  isSessionActive,
  sessionPanel,
}: RegisterSessionPanelProps) {
  if (!sessionPanel) {
    return null;
  }

  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg border">
      {isSessionActive && (
        <FadeIn className="flex items-center gap-2">
          <div className="w-2 h-2 bg-green-600 rounded-full animate-pulse" />
          <p className="text-sm text-green-600 font-medium">Active Session</p>
        </FadeIn>
      )}
      <SessionManager sessionPanel={sessionPanel} />
    </div>
  );
}
