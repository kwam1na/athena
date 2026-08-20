import { OrderEmail, orderEmailPreviewVariants } from "./OrderEmail";

export default function OrderEmailReadyPreview() {
  return <OrderEmail {...orderEmailPreviewVariants.readyPickup} />;
}
