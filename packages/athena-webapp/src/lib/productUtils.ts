import { capitalizeWords } from "./utils";

export const getProductName = (item: any) => {
  if (item.productCategory == "Hair") {
    if (!item.colorName) return capitalizeWords(item.productName);
    return `${item.length}" ${capitalizeWords(item.colorName)} ${item.productName}`;
  }

  return item.productName;
};
