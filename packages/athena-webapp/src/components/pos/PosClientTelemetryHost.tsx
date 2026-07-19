import useGetActiveStore from "@/hooks/useGetActiveStore";
import { usePosClientTelemetryDrain } from "@/lib/pos/infrastructure/telemetry/usePosClientTelemetryDrain";

/**
 * Invisible host that keeps the POS telemetry drain (and its error-capture
 * rails) alive while a POS surface is mounted.
 */
export function PosClientTelemetryHost() {
  const { activeStore } = useGetActiveStore();
  usePosClientTelemetryDrain({ storeId: activeStore?._id });
  return null;
}
