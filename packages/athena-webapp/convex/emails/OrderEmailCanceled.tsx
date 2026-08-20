import { OrderEmail, orderEmailPreviewVariants } from "./OrderEmail";

export default function OrderEmailCanceledPreview() {
  return <OrderEmail {...orderEmailPreviewVariants.canceled} />;
}
