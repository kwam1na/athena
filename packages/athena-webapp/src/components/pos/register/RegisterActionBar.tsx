import { ArrowRightIcon, BanknoteIcon, LockKeyhole } from "lucide-react";
import { Link } from "@tanstack/react-router";

import type {
  RegisterCloseoutControlState,
  RegisterInfoState,
  RegisterSessionPanelState,
} from "@/lib/pos/presentation/register/registerUiState";
import { Button } from "@/components/ui/button";
import { getOrigin } from "~/src/lib/navigationUtils";
import { cn } from "~/src/lib/utils";

import { RegisterActions } from "../RegisterActions";
import { RegisterSessionPanel } from "./RegisterSessionPanel";

interface RegisterActionBarProps {
  closeoutControl: RegisterCloseoutControlState | null;
  registerInfo: RegisterInfoState;
  sessionPanel: RegisterSessionPanelState | null;
}

export function RegisterActionBar({
  closeoutControl,
  registerInfo,
  sessionPanel,
}: RegisterActionBarProps) {
  return (
    <div className="flex items-center gap-4">
      <RegisterSessionPanel sessionPanel={sessionPanel} />

      <div
        className={cn(
          "flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg border",
          !registerInfo.hasTerminal && "animate-pulse text-red-500",
        )}
      >
        <RegisterActions
          customerName={registerInfo.customerName}
          registerNumber={registerInfo.registerLabel}
          hasTerminal={registerInfo.hasTerminal}
        />
        {closeoutControl ? (
          <>
            <Button
              className="h-10"
              disabled={!closeoutControl.canCorrectOpeningFloat}
              onClick={closeoutControl.onRequestOpeningFloatCorrection}
              type="button"
              variant="outline"
            >
              <BanknoteIcon className="mr-2 h-4 w-4" />
              Float
            </Button>
            <Button
              className="h-10"
              disabled={!closeoutControl.canCloseout}
              onClick={closeoutControl.onRequestCloseout}
              type="button"
              variant="outline"
            >
              <LockKeyhole className="mr-2 h-4 w-4" />
              Closeout
            </Button>
          </>
        ) : null}
        {!registerInfo.hasTerminal && (
          <Link
            params={(params) => ({
              ...params,
              orgUrlSlug: params.orgUrlSlug!,
              storeUrlSlug: params.storeUrlSlug!,
            })}
            to="/$orgUrlSlug/store/$storeUrlSlug/pos/settings"
            search={{
              o: getOrigin(),
            }}
            className="flex h-10 items-center gap-2 px-3"
          >
            <p className="text-sm font-semibold">Configure</p>
            <ArrowRightIcon className="w-4 h-4" />
          </Link>
        )}
      </div>
    </div>
  );
}
