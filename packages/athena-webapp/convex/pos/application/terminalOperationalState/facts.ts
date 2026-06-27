import type { Doc, Id } from "../../../_generated/dataModel";
import type { TerminalSyncEvidence } from "../../domain/terminalSyncEvidence";

export type TerminalRegisterSessionLink = {
  registerSessionId: Id<"registerSession">;
  status: Extract<Doc<"registerSession">["status"], "active" | "open">;
} | null;

export type TerminalOperationalFacts = {
  activeRegisterSession: Doc<"registerSession"> | null;
  drawerAuthorityRegisterSession: Doc<"registerSession"> | null;
  latestRegisterSession: Doc<"registerSession"> | null;
  rawSyncEvidence: TerminalSyncEvidence;
  registerSessionLink: TerminalRegisterSessionLink;
  runtimeStatus: Doc<"posTerminalRuntimeStatus"> | null;
};
