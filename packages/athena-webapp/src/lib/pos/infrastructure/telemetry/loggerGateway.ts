import type { PosTelemetryGateway } from "@/lib/pos/application/ports";
import { logger, type LogContext } from "@/lib/logger";
import { enqueuePosClientEvent } from "./telemetryBuffer";

function toMetadataRecord(metadata: unknown): Record<string, unknown> | undefined {
  if (typeof metadata !== "object" || metadata === null) {
    return undefined;
  }
  return metadata as Record<string, unknown>;
}

export const loggerGateway: PosTelemetryGateway = {
  debug(message, metadata) {
    logger.debug(message, metadata as LogContext | undefined);
  },
  info(message, metadata) {
    logger.info(message, metadata as LogContext | undefined);
  },
  warn(message, metadata) {
    logger.warn(message, metadata as LogContext | undefined);
    enqueuePosClientEvent({
      level: "warn",
      flow: "runtime",
      message,
      metadata: toMetadataRecord(metadata),
    });
  },
  error(message, metadata) {
    logger.error(message, metadata as LogContext | Error | undefined);
    enqueuePosClientEvent({
      level: "error",
      flow: "runtime",
      message,
      error: metadata instanceof Error ? metadata : undefined,
      metadata: metadata instanceof Error ? undefined : toMetadataRecord(metadata),
    });
  },
};
