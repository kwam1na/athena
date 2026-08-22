import { Address, OnlineOrder } from "../types";
import { ALL_COUNTRIES } from "./constants/countries";
import { accraNeighborhoods, ghanaRegions } from "./constants/ghana";
import { currencyFormatter as sharedCurrencyFormatter } from "../shared/currencyFormatter";
import { capitalizeWords } from "../shared/textCase";
import { formatDate } from "../shared/formatDate";
import { generateTransactionNumber } from "../shared/transactionNumber";

export function toSlug(str: string) {
  return str
    .toLowerCase() // Convert to lowercase
    .trim() // Trim leading and trailing spaces
    .replace(/[^\w\s-]/g, "") // Remove non-word characters (except space and hyphen)
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/-+/g, "-"); // Replace multiple hyphens with a single hyphen
}

export function getAddressString(address: Address) {
  const joinAddressParts = (...parts: Array<string | undefined | null>) =>
    parts
      .map((part) => part?.trim())
      .filter((part): part is string => Boolean(part))
      .join(", ");

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
    return joinAddressParts(
      address?.houseNumber,
      address?.street,
      neighborhood,
      region,
      country,
    );
  }

  if (address.country == "US") {
    return joinAddressParts(
      address?.address,
      address?.city,
      [address?.state, address?.zip]
        .map((part) => part?.trim())
        .filter(Boolean)
        .join(" "),
      country,
    );
  }

  return joinAddressParts(address?.address, address?.city, country);
}

export { capitalizeWords, formatDate, generateTransactionNumber };

export function currencyFormatter(currency: string) {
  return sharedCurrencyFormatter(currency);
}

export const getProductName = (item: any) => {
  if (item.productCategory == "Hair") {
    if (!item.colorName) return capitalizeWords(item.productName || "");
    return `${item.length ? `${item.length}" ` : ""} ${capitalizeWords(item.colorName || "")} ${capitalizeWords(item.productName || "")}`;
  }

  if (item.length) {
    return `${item.length}" ${capitalizeWords(item.productName || "")}`;
  }

  return capitalizeWords(item.productName || "");
};
