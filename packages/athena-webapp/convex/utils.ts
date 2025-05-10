import { Address, OnlineOrder } from "../types";
import { ALL_COUNTRIES } from "./constants/countries";
import { accraNeighborhoods, ghanaRegions } from "./constants/ghana";

export function toSlug(str: string) {
  return str
    .toLowerCase() // Convert to lowercase
    .trim() // Trim leading and trailing spaces
    .replace(/[^\w\s-]/g, "") // Remove non-word characters (except space and hyphen)
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/-+/g, "-"); // Replace multiple hyphens with a single hyphen
}

export function getAddressString(address: Address) {
  const country =
    ALL_COUNTRIES.find((c) => c.code == address?.country)?.name ||
    address?.country;

  const region =
    ghanaRegions.find((r) => r.code == address?.region)?.name ||
    address?.region;

  const neighborhood =
    accraNeighborhoods.find((n) => n.value == address?.neighborhood)?.label ||
    address?.neighborhood;

  if (address.country == "GH") {
    return `${address?.houseNumber}, ${address?.street}, ${neighborhood}, ${region}, ${country}`;
  }

  if (address.country == "US") {
    return `${address?.address}, ${address?.city}, ${address?.state} ${address?.zip}, ${country}`;
  }

  return `${address?.address}, ${address?.city}, ${country}`;
}

export function capitalizeWords(str: string): string {
  if (!str) return str;
  return str
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function currencyFormatter(currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

export function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export const getProductName = (item: any) => {
  if (item.productCategory == "Hair") {
    if (!item.colorName) return capitalizeWords(item.productName);
    return `${item.length}" ${capitalizeWords(item.colorName)} ${capitalizeWords(item.productName)}`;
  }

  if (item.length) {
    return `${item.length}" ${capitalizeWords(item.productName)}`;
  }

  return capitalizeWords(item.productName);
};
