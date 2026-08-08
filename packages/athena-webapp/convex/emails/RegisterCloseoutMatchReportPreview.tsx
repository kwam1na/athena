import {
  RegisterCloseoutVarianceAlert,
  registerCloseoutVarianceAlertPreviewProps,
} from "./RegisterCloseoutVarianceAlert";

export default function RegisterCloseoutMatchReportPreview() {
  return (
    <RegisterCloseoutVarianceAlert
      {...registerCloseoutVarianceAlertPreviewProps}
      countedCash="GH₵615.00"
      expectedCash="GH₵615.00"
      notes="Drawer counted and closed at the end of the shift."
      outcome="closed"
      reason={undefined}
      variance="GH₵0.00"
      varianceDirection="matched"
    />
  );
}
