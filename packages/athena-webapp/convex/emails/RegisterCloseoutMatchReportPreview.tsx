import RegisterCloseoutVarianceAlert, {
  registerCloseoutVarianceAlertPreviewProps,
} from "./RegisterCloseoutVarianceAlert";

export default function RegisterCloseoutMatchReportPreview() {
  return (
    <RegisterCloseoutVarianceAlert
      {...registerCloseoutVarianceAlertPreviewProps}
      countedCash="GH₵1,244.00"
      expectedCash="GH₵1,244.00"
      notes="Drawer counted and closed at the end of the shift."
      reason={undefined}
      variance="GH₵0.00"
      varianceDirection="matched"
    />
  );
}
