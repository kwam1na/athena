import DailyManagerReport, {
  dailyManagerReportPreviewProps,
} from "./DailyManagerReport";

export default function DailyManagerReportBordered() {
  return (
    <DailyManagerReport
      {...dailyManagerReportPreviewProps}
      frameVariant="bordered"
    />
  );
}
