import {
  ArrowRightIcon,
  BanknoteIcon,
  LockKeyhole,
  RotateCcw,
} from "lucide-react";
import { Link } from "@tanstack/react-router";

import type {
  RegisterCashierCardState,
  RegisterCloseoutControlState,
  RegisterDrawerGateState,
  RegisterInfoState,
  RegisterSessionPanelState,
} from "@/lib/pos/presentation/register/registerUiState";
import { Button } from "@/components/ui/button";
import { getOrigin } from "~/src/lib/navigationUtils";
import { cn } from "~/src/lib/utils";

import { RegisterActions } from "../RegisterActions";
import { RegisterSessionPanel } from "./RegisterSessionPanel";

interface RegisterActionBarProps {
  cashierCard: RegisterCashierCardState | null;
  closeoutControl: RegisterCloseoutControlState | null;
  drawerGate?: RegisterDrawerGateState | null;
  registerInfo: RegisterInfoState;
  sessionPanel: RegisterSessionPanelState | null;
}

export function RegisterActionBar({
  cashierCard,
  closeoutControl,
  drawerGate,
  registerInfo,
  sessionPanel,
}: RegisterActionBarProps) {
  const drawerRecoveryGate = drawerGate?.mode === "recovery" ? drawerGate : null;

  return (
    <div className="flex flex-wrap items-center justify-end gap-4">
      <RegisterCashierControl cashierCard={cashierCard} />
      <RegisterSessionPanel sessionPanel={sessionPanel} />

      <div
        className={cn(
          "flex items-center gap-3 rounded-lg border bg-surface-raised px-3 py-2",
          !registerInfo.hasTerminal && "animate-pulse text-danger",
        )}
      >
        <RegisterActions
          customerName={registerInfo.customerName}
          registerNumber={registerInfo.registerLabel}
          hasTerminal={registerInfo.hasTerminal}
        />
        {drawerRecoveryGate ? (
          <div className="flex items-center gap-2 border-l border-border pl-3">
            <p className="text-xs font-medium text-muted-foreground">
              Drawer closed
            </p>
            <Button
              className="h-10"
              disabled={
                drawerRecoveryGate.isSubmitting ||
                drawerRecoveryGate.canOpenDrawer === false
              }
              onClick={() => void drawerRecoveryGate.onSubmit?.()}
              type="button"
              variant="outline"
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Open drawer
            </Button>
          </div>
        ) : closeoutControl ? (
          <>
            {closeoutControl.canShowOpeningFloatCorrection ? (
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
            ) : null}
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

function RegisterCashierControl({
  cashierCard,
}: {
  cashierCard: RegisterCashierCardState | null;
}) {
  return (
    <div className="flex h-12 min-w-[15rem] items-center justify-between gap-4 rounded-lg border bg-surface-raised px-4">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Cashier
        </p>
        <p className="max-w-36 truncate text-sm font-medium capitalize text-foreground">
          {cashierCard?.cashierName ?? "Unassigned"}
        </p>
      </div>
      {cashierCard ? (
        <Button
          className="h-8 shrink-0 px-3 text-xs"
          onClick={cashierCard.onSignOut}
          title="Sign out"
          type="button"
          variant="ghost"
        >
          Sign out
        </Button>
      ) : null}
    </div>
  );
}
