import { capitalizeWords } from "./utils";

export const getProductName = (item: any) => {
  if (item.productCategory == "Hair") {
    if (!item.colorName) return capitalizeWords(item.productName);
    return `${item.length ? `${item.length}" ` : ""} ${capitalizeWords(item.colorName)} ${capitalizeWords(item.productName)}`;
  }

  if (item.length) {
    return `${item.length}" ${capitalizeWords(item.productName)}`;
  }

  return capitalizeWords(item.productName);
};

export const sortProduct = (a: any, b: any) => {
  if (a.productCategory == "Hair" && b.productCategory == "Hair") {
    return a.length - b.length;
  }

  return a.price - b.price;
};
