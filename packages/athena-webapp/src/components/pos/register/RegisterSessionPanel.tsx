import { FadeIn } from "../../common/FadeIn";
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
      <SessionManager sessionPanel={sessionPanel} />
    </div>
  );
}
