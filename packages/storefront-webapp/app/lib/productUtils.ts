import { ProductSku } from "@athena/webapp";
import { capitalizeWords } from "./utils";

export const getProductName = (item: ProductSku) => {
  if (item.productCategory == "Hair") {
    if (!item.colorName) return capitalizeWords(item.productName);
    return `${item.length}" ${capitalizeWords(item.colorName)} ${item.productName}`;
  }

  return item.productName;
};

export const sortProduct = (a: ProductSku, b: ProductSku) => {
  if (a.productCategory == "Hair" && b.productCategory == "Hair") {
    return a.length - b.length;
  }

  return a.price - b.price;
};
