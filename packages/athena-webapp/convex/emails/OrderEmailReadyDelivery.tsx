import { OrderEmail, orderEmailPreviewVariants } from "./OrderEmail";

export default function OrderEmailReadyDeliveryPreview() {
  return <OrderEmail {...orderEmailPreviewVariants.readyDelivery} />;
}
