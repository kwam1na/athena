export const getDiscountValue = (
  subtotal: number,
  discount?: Record<string, any> | null
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
  discount?: Record<string, any> | null;
  deliveryFee: number;
  subtotal: number;
  inCents?: boolean;
}) => {
  const discountValue = getDiscountValue(subtotal, discount);
  const base = inCents ? 100 : 1;
  return subtotal - discountValue * base + deliveryFee;
};
