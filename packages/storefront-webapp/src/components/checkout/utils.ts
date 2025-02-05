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
}: {
  discount?: Discount | null;
  deliveryFee: number;
  subtotal: number;
}) => {
  const discountValue = getDiscountValue(subtotal, discount);
  return subtotal - discountValue + deliveryFee;
};
