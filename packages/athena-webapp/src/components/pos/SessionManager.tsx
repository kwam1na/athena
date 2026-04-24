import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PauseCircle, PlayCircle, Clock, Plus, Ban } from "lucide-react";

import type { RegisterSessionPanelState } from "@/lib/pos/presentation/register/registerUiState";

import { FadeIn } from "../common/FadeIn";
import { HeldSessionsList } from "./session/HeldSessionsList";

interface SessionManagerProps {
  sessionPanel: RegisterSessionPanelState;
}

export function SessionManager({ sessionPanel }: SessionManagerProps) {
  return (
    <div className="flex items-center gap-4">
      {sessionPanel.activeSessionNumber && (
        <FadeIn>
          <Badge variant="outline" className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {sessionPanel.activeSessionNumber}
          </Badge>
        </FadeIn>
      )}

      {sessionPanel.hasExpiredSession && (
        <Badge
          variant="outline"
          className="flex items-center gap-1 text-red-500 bg-red-50"
        >
          <Clock className="h-3 w-3" />
          Expired
        </Badge>
      )}

      {sessionPanel.activeSessionNumber && (
        <Button
          variant="outline"
          size="sm"
          className="flex h-10 items-center gap-2 px-4"
          onClick={() => void sessionPanel.onHoldCurrentSession()}
          disabled={!sessionPanel.canHoldSession}
        >
          <PauseCircle className="h-4 w-4" />
          Hold
        </Button>
      )}

      {sessionPanel.activeSessionNumber && (
        <Button
          variant="outline"
          size="sm"
          className="flex h-10 items-center gap-2 px-4"
          onClick={() => void sessionPanel.onVoidCurrentSession()}
        >
          <Ban className="h-4 w-4 text-destructive" />
          Void
        </Button>
      )}

      {sessionPanel.heldSessions.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="flex h-10 items-center gap-2 px-4"
            >
              <PlayCircle className="h-4 w-4" />
              Resume
              <Badge variant="secondary" className="ml-1">
                {sessionPanel.heldSessions.length}
              </Badge>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-full">
            <HeldSessionsList
              sessions={sessionPanel.heldSessions}
              onResumeSession={sessionPanel.onResumeSession}
              onVoidSession={sessionPanel.onVoidHeldSession}
            />
          </PopoverContent>
        </Popover>
      )}

      <Button
        variant="outline"
        size="sm"
        onClick={() => void sessionPanel.onStartNewSession()}
        disabled={sessionPanel.disableNewSession}
        className="flex h-10 items-center gap-2 px-4"
      >
        <Plus className="h-4 w-4" />
        New
      </Button>
    </div>
  );
}
