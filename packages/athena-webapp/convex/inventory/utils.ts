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
  deliveryFee: number | null;
  subtotal: number;
}) => {
  const discountValue =
    parseInt(discount?.totalDiscount) * 100 ||
    getDiscountValue(subtotal, discount);

  const baseForDiscount = discount?.type === "percentage" ? 1 : 100;
  return subtotal - discountValue * baseForDiscount + (deliveryFee || 0) * 100;
};
