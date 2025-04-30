export const formatNumber = (num: number | undefined): string => {
  if (num === undefined) return "0";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(num);
};
