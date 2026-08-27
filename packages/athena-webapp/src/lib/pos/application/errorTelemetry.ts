/**
 * Application-layer hook for reporting unexpected POS errors to telemetry.
 *
 * The application layer cannot depend on infrastructure, so the sink is
 * registered from the composition root (the telemetry infrastructure) and
 * invoked here. Reporting is fire-and-forget and must never throw into a
 * use case.
 */

import type {
  PosClientEventFlow,
  PosDiagnosticClassification,
  PosDiagnosticOperation,
} from "~/shared/posDiagnosticRedaction";

export type PosErrorTelemetryFlow = PosClientEventFlow;

export type PosErrorTelemetryReport = {
  classification?: PosDiagnosticClassification;
  flow?: PosErrorTelemetryFlow;
  message: string;
  localRegisterSessionId?: string;
  metadata?: Record<string, string | number | boolean>;
  operation?: PosDiagnosticOperation;
  error: unknown;
};

export type PosErrorTelemetrySink = (report: PosErrorTelemetryReport) => void;

let sink: PosErrorTelemetrySink | null = null;

export function setPosErrorTelemetrySink(
  nextSink: PosErrorTelemetrySink | null,
): void {
  sink = nextSink;
}

export function reportPosUnexpectedError(
  report: PosErrorTelemetryReport,
): void {
  try {
    sink?.(report);
  } catch {
    // Telemetry must never break a use case.
  }
}
