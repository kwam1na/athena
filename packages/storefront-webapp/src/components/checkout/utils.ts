import { Discount } from "./CheckoutProvider";

export const getDiscountValue = (
  subtotal: number,
  discount?: Discount | null
) => {
  return (
    (discount?.type === "percentage"
      ? (subtotal * discount?.value) / 100
      : discount?.value) || 0
  );
};

export const getOrderAmount = ({
  discount,
  deliveryFee,
  subtotal,
  inCents,
}: {
  discount?: Discount | null;
  deliveryFee: number;
  subtotal: number;
  inCents?: boolean;
}) => {
  const discountValue = getDiscountValue(subtotal, discount);
  const base = inCents ? 100 : 1;
  return subtotal - discountValue * base + deliveryFee;
};
