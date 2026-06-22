import {
  StorePulseSummaryView,
  type StorePulseOperatorSnapshot,
  type StorePulseSummary,
  type StorePulseTrendDay,
  type StorePulseWindow,
} from "../../store-pulse/StorePulseSummaryView";

export type POSSalesTrendDay = StorePulseTrendDay;
export type POSOperatorSnapshot = StorePulseOperatorSnapshot;
export type POSStorePulseSummary = StorePulseSummary;
export type POSStorePulseWindow = StorePulseWindow;

export function POSStorePulseSection({
  currencyFormatter,
  hasFullAdminAccess,
  onPulseWindowChange,
  pulseWindow,
  todaySummary,
}: {
  currencyFormatter: Intl.NumberFormat;
  hasFullAdminAccess: boolean;
  onPulseWindowChange: (pulseWindow: POSStorePulseWindow) => void;
  pulseWindow: POSStorePulseWindow;
  todaySummary: POSStorePulseSummary | undefined;
}) {
  return (
    <StorePulseSummaryView
      canViewFinancialDetails={hasFullAdminAccess}
      currencyFormatter={currencyFormatter}
      onPulseWindowChange={onPulseWindowChange}
      pulseWindow={pulseWindow}
      summary={todaySummary}
    />
  );
}
