export const getDiscountValue = (
  subtotal: number,
  discount?: Record<string, any> | null
) => {
  return (
    (discount?.type === "percentage"
      ? subtotal * (discount?.value / 100)
      : discount?.value) || 0
  );
};

export const getOrderAmount = ({
  discount,
  deliveryFee,
  subtotal,
}: {
  discount?: Record<string, any> | null;
  deliveryFee: number;
  subtotal: number;
}) => {
  const discountValue = getDiscountValue(subtotal, discount);
  return subtotal - discountValue + deliveryFee;
};
