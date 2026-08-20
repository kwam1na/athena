import { motion } from "framer-motion";

import { formatRegisterSessionCode } from "@/lib/pos/presentation/registerSessionCode";
import { formatRegisterHeaderName } from "./registerSessionIdentityPresentation";

const IDENTITY_TRANSITION = {
  duration: 0.14,
  ease: "easeOut" as const,
};

export type RegisterSessionIdentityModel = {
  _id: string;
  registerNumber?: string | null;
  terminalName?: string | null;
};

export function RegisterSessionIdentity({
  fallbackTitle = "Register detail",
  registerSession,
  showSessionCode = false,
}: {
  fallbackTitle?: string;
  registerSession?: RegisterSessionIdentityModel | null;
  showSessionCode?: boolean;
}) {
  const terminalName = registerSession?.terminalName?.trim();
  const sessionCode = showSessionCode
    ? formatRegisterSessionCode(registerSession?._id)
    : undefined;

  return (
    <div
      className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-1.5 sm:gap-y-0.5"
      data-testid="register-session-identity"
    >
      <h1 className="min-w-0 truncate text-base font-semibold leading-5 text-foreground sm:text-sm">
        {registerSession
          ? formatRegisterHeaderName(registerSession.registerNumber)
          : fallbackTitle}
      </h1>
      {terminalName ? (
        <motion.span
          animate={{ opacity: 1, y: 0 }}
          className="min-w-0 truncate text-xs text-muted-foreground sm:text-sm"
          initial={{ opacity: 0, y: 2 }}
          key={`terminal-${registerSession?._id}-${terminalName}`}
          transition={IDENTITY_TRANSITION}
        >
          <span className="hidden sm:inline">/ </span>
          {terminalName}
        </motion.span>
      ) : null}
      {sessionCode ? (
        <motion.span
          animate={{ opacity: 1, y: 0 }}
          className="whitespace-nowrap text-xs text-muted-foreground sm:text-sm"
          initial={{ opacity: 0, y: 2 }}
          key={`session-${registerSession?._id}-${sessionCode}`}
          transition={IDENTITY_TRANSITION}
        >
          <span className="hidden sm:inline">/ </span>
          {sessionCode}
        </motion.span>
      ) : null}
    </div>
  );
}
