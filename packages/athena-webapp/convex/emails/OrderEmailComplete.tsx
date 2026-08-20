import { OrderEmail, orderEmailPreviewVariants } from "./OrderEmail";

export default function OrderEmailCompletePreview() {
  return <OrderEmail {...orderEmailPreviewVariants.complete} />;
}
