import DailyManagerReport, {
  dailyManagerReportPreviewProps,
} from "./DailyManagerReport";

export default function DailyManagerReportUnbordered() {
  return (
    <DailyManagerReport
      {...dailyManagerReportPreviewProps}
      frameVariant="unbordered"
    />
  );
}
