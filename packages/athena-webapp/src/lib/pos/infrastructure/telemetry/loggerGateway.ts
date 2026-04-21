import type { PosTelemetryGateway } from "@/lib/pos/application/ports";
import { logger, type LogContext } from "@/lib/logger";

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
