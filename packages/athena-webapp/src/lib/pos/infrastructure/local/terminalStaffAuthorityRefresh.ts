import type { Id } from "~/convex/_generated/dataModel";
import type { CommandResult } from "~/shared/commandResult";

import type { PosLocalStaffAuthorityRecord } from "@/lib/pos/application/posLocalStoreTypes";
import type { PosLocalStorePort } from "@/lib/pos/application/posLocalStorePort";

type PosLocalRuntimeStore = PosLocalStorePort;

type RefreshTerminalStaffAuthority = (args: {
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
}) => Promise<CommandResult<PosLocalStaffAuthorityRecord[]>>;

type TerminalStaffAuthorityRefreshClassification =
  | {
      kind: "accepted";
      records: PosLocalStaffAuthorityRecord[];
    }
  | {
      kind: "authoritative_empty";
      records: [];
    }
  | {
      code?: string;
      kind: "preserve_existing";
      message?: string;
      source: "exception" | "result";
    };

export type TerminalStaffAuthorityRefreshOutcome =
  | {
      records: PosLocalStaffAuthorityRecord[];
      status: "ready";
    }
  | {
      records: [];
      status: "authority_cleared";
    }
  | {
      code?: string;
      message?: string;
      status: "preserved";
    }
  | {
      message: string;
      status: "write_failed";
    };

export function classifyTerminalStaffAuthorityRefreshResult(
  result: CommandResult<PosLocalStaffAuthorityRecord[]>,
): TerminalStaffAuthorityRefreshClassification {
  if (result.kind !== "ok") {
    return {
      code: result.kind === "user_error" ? result.error.code : undefined,
      kind: "preserve_existing",
      message:
        result.kind === "user_error"
          ? result.error.message
          : "Staff authority refresh failed.",
      source: "result",
    };
  }

  if (result.data.length === 0) {
    return {
      kind: "authoritative_empty",
      records: [],
    };
  }

  return {
    kind: "accepted",
    records: result.data,
  };
}

export async function refreshAndStoreTerminalStaffAuthority(input: {
  localStore: Pick<PosLocalRuntimeStore, "replaceStaffAuthoritySnapshot">;
  mapRecords?: (
    records: PosLocalStaffAuthorityRecord[],
  ) => Promise<PosLocalStaffAuthorityRecord[]> | PosLocalStaffAuthorityRecord[];
  refreshTerminalStaffAuthority: RefreshTerminalStaffAuthority;
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
}): Promise<TerminalStaffAuthorityRefreshOutcome> {
  let result: CommandResult<PosLocalStaffAuthorityRecord[]>;
  try {
    result = await input.refreshTerminalStaffAuthority({
      storeId: input.storeId,
      terminalId: input.terminalId,
    });
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      status: "preserved",
    };
  }

  const classification = classifyTerminalStaffAuthorityRefreshResult(result);
  if (classification.kind === "preserve_existing") {
    return {
      code: classification.code,
      message: classification.message,
      status: "preserved",
    };
  }

  const records =
    classification.kind === "authoritative_empty"
      ? []
      : input.mapRecords
        ? await input.mapRecords(classification.records)
        : classification.records;
  const writeResult = await input.localStore.replaceStaffAuthoritySnapshot({
    records,
    storeId: input.storeId,
    terminalId: input.terminalId,
  });
  if (!writeResult.ok) {
    return {
      message: writeResult.error.message,
      status: "write_failed",
    };
  }

  return records.length === 0
    ? {
        records: [],
        status: "authority_cleared",
      }
    : {
        records,
        status: "ready",
      };
}
