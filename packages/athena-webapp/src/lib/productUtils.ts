import { capitalizeWords } from "./utils";

export const getProductName = (item: any) => {
  if (item.productCategory == "Hair") {
    return [
      item.length ? `${item.length}"` : undefined,
      item.colorName ? capitalizeWords(item.colorName) : undefined,
      capitalizeWords(item.productName || ""),
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (item.length) {
    return `${item.length}" ${capitalizeWords(item.productName || "")}`;
  }

  return capitalizeWords(item.productName || "");
};

export const sortProduct = (a: any, b: any) => {
  if (a.productCategory == "Hair" && b.productCategory == "Hair") {
    return a.length - b.length;
  }

  return a.price - b.price;
};
