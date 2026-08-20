import { OrderEmail, orderEmailPreviewVariants } from "./OrderEmail";

export default function OrderEmailOutForDeliveryPreview() {
  return <OrderEmail {...orderEmailPreviewVariants.outForDelivery} />;
}
