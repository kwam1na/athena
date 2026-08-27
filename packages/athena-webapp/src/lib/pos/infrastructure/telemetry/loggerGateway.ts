import type { PosTelemetryGateway } from "@/lib/pos/application/ports";
import { isExpectedPosTelemetryOutcome } from "@/lib/pos/application/expectedTelemetryOutcome";
import { logger, type LogContext } from "@/lib/logger";
import type {
  PosDiagnosticClassification,
  PosDiagnosticOperation,
} from "~/shared/posDiagnosticRedaction";
import type { PosClientEventFlow } from "./telemetryBuffer";
import { enqueuePosClientEvent } from "./telemetryBuffer";

export const loggerGateway: PosTelemetryGateway = {
  debug(message, metadata) {
    logger.debug(message, metadata as LogContext | undefined);
  },
  info(message, metadata) {
    logger.info(message, metadata as LogContext | undefined);
  },
  warn(message, metadata) {
    logger.warn(message, metadata as LogContext | undefined);
  },
  error(message, metadata) {
    logger.error(message, metadata as LogContext | Error | undefined);
  },
};

export function reportPosHandledException(input: {
  classification?: PosDiagnosticClassification;
  error: unknown;
  flow: PosClientEventFlow;
  level?: "error" | "warn";
  localMessage: string;
  operation: PosDiagnosticOperation;
}): void {
  const level = input.level ?? "error";
  if (level === "warn") loggerGateway.warn(input.localMessage, input.error);
  else loggerGateway.error(input.localMessage, input.error);

  if (isExpectedPosTelemetryOutcome(input.error)) return;
  enqueuePosClientEvent({
    classification:
      input.classification ??
      (level === "warn"
        ? "continuity_warning"
        : "unexpected_application_error"),
    error: input.error,
    flow: input.flow,
    level,
    operation: input.operation,
  });
}
