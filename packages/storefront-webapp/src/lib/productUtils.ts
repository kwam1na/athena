import { BagItem, ProductSku, SavedBagItem } from "@athena/webapp";
import { capitalizeWords } from "./utils";

export const getProductName = (item: ProductSku | BagItem | SavedBagItem) => {
  if (item.productCategory == "Hair") {
    if (!item.colorName)
      return capitalizeWords(item.productName || "Unavailable");

    return `${item.length}" ${item.colorName} ${capitalizeWords(item.productName || "")}`;
  }

  return capitalizeWords(item.productName || "Unavailable");
};

export const sortProduct = (a: any, b: any) => {
  if (a.productCategory == "Hair" && b.productCategory == "Hair") {
    return a.length - b.length;
  }

  return a.price - b.price;
};
