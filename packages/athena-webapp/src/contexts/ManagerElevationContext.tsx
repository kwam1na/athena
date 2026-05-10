import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery } from "convex/react";

import {
  StaffAuthenticationDialog,
  type StaffAuthMode,
  type StaffAuthenticationResult,
} from "@/components/staff-auth/StaffAuthenticationDialog";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { useGetTerminal } from "@/hooks/useGetTerminal";
import { runCommand } from "@/lib/errors/runCommand";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import { userError } from "~/shared/commandResult";

export type ManagerElevation = {
  displayName: string;
  elevationId: Id<"managerElevation">;
  expiresAt: number;
  staffProfileId: Id<"staffProfile">;
  startedAt: number;
};

type ManagerElevationAuthenticationResult = StaffAuthenticationResult & {
  elevationId: Id<"managerElevation">;
  expiresAt: number;
};

type ManagerElevationContextValue = {
  activeElevation: ManagerElevation | null;
  endManagerElevation: () => Promise<void>;
  isManagerElevated: boolean;
  startManagerElevation: () => void;
};

const ManagerElevationContext = createContext<
  ManagerElevationContextValue | undefined
>(undefined);

function getStaffDisplayName(result: StaffAuthenticationResult) {
  return (
    result.staffProfile.fullName ||
    [result.staffProfile.firstName, result.staffProfile.lastName]
      .filter(Boolean)
      .join(" ") ||
    "Manager"
  );
}

function toStaffAuthenticationResult(
  result: ManagerElevationAuthenticationResult,
): StaffAuthenticationResult {
  return {
    activeRoles: result.activeRoles,
    approvalProofId: result.approvalProofId,
    approvedByStaffProfileId: result.approvedByStaffProfileId,
    expiresAt: result.expiresAt,
    staffProfile: result.staffProfile,
    staffProfileId: result.staffProfileId,
  };
}

export function ManagerElevationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [activeElevation, setActiveElevation] =
    useState<ManagerElevation | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const pendingElevationRef =
    useRef<ManagerElevationAuthenticationResult | null>(null);
  const { activeStore } = useGetActiveStore();
  const terminal = useGetTerminal();
  const activeServerElevation = useQuery(
    api.operations.managerElevations.getActiveManagerElevation,
    activeStore?._id && terminal?._id
      ? {
          storeId: activeStore._id,
          terminalId: terminal._id,
        }
      : "skip",
  );
  const startManagerElevationMutation = useMutation(
    api.operations.managerElevations.startManagerElevation,
  );
  const endManagerElevationMutation = useMutation(
    api.operations.managerElevations.endManagerElevation,
  );

  const resolvedElevation = useMemo<ManagerElevation | null>(() => {
    if (!activeServerElevation) {
      return activeElevation;
    }

    return {
      displayName: activeServerElevation.managerDisplayName,
      elevationId: activeServerElevation.elevationId,
      expiresAt: activeServerElevation.expiresAt,
      staffProfileId: activeServerElevation.managerStaffProfileId,
      startedAt: activeServerElevation.startedAt,
    };
  }, [activeElevation, activeServerElevation]);

  const endManagerElevation = useCallback(async () => {
    const elevationToEnd = resolvedElevation;
    setActiveElevation(null);
    setDialogOpen(false);

    if (!activeStore?._id || !terminal?._id || !elevationToEnd?.elevationId) {
      return;
    }

    await runCommand(() =>
      endManagerElevationMutation({
        elevationId: elevationToEnd.elevationId,
        storeId: activeStore._id,
        terminalId: terminal._id,
      }),
    );
  }, [
    activeStore?._id,
    endManagerElevationMutation,
    resolvedElevation,
    terminal?._id,
  ]);

  const startManagerElevation = useCallback(() => {
    setDialogOpen(true);
  }, []);

  const value = useMemo<ManagerElevationContextValue>(
    () => ({
      activeElevation: resolvedElevation,
      endManagerElevation,
      isManagerElevated: Boolean(resolvedElevation),
      startManagerElevation,
    }),
    [endManagerElevation, resolvedElevation, startManagerElevation],
  );

  async function authenticateManager(args: {
    mode: StaffAuthMode;
    pinHash: string;
    username: string;
  }) {
    if (!activeStore?._id || !terminal?._id) {
      return userError({
        code: "precondition_failed",
        message:
          "Select a store and register this terminal before starting manager elevation.",
      });
    }

    const result = await runCommand(() =>
      startManagerElevationMutation({
        pinHash: args.pinHash,
        reason: "Manager elevation",
        storeId: activeStore._id,
        terminalId: terminal._id,
        username: args.username,
      }),
    );

    if (result.kind !== "ok") {
      return result;
    }

    pendingElevationRef.current =
      result.data as ManagerElevationAuthenticationResult;

    return {
      kind: "ok",
      data: toStaffAuthenticationResult(pendingElevationRef.current),
    } as const;
  }

  return (
    <ManagerElevationContext.Provider value={value}>
      {children}
      <StaffAuthenticationDialog
        open={dialogOpen}
        onDismiss={() => setDialogOpen(false)}
        copy={{
          title: "Manager elevation",
          description: "Enter manager credentials to elevate this session",
          submitLabel: "Start elevation",
        }}
        getSuccessMessage={(result) =>
          `Manager elevation active for ${getStaffDisplayName(result)}`
        }
        onAuthenticate={authenticateManager}
        onAuthenticated={(result) => {
          const elevation = pendingElevationRef.current;
          pendingElevationRef.current = null;

          if (!elevation) {
            setDialogOpen(false);
            return;
          }

          setActiveElevation({
            displayName: getStaffDisplayName(elevation),
            elevationId: elevation.elevationId,
            expiresAt: elevation.expiresAt,
            staffProfileId: result.staffProfileId,
            startedAt: Date.now(),
          });
          setDialogOpen(false);
        }}
      />
    </ManagerElevationContext.Provider>
  );
}

export function useManagerElevation() {
  const context = useContext(ManagerElevationContext);

  if (context === undefined) {
    throw new Error(
      "useManagerElevation must be used within a ManagerElevationProvider",
    );
  }

  return context;
}

export function useOptionalManagerElevation() {
  return useContext(ManagerElevationContext) ?? null;
}
