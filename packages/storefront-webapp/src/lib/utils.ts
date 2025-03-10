import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { ZodError } from "zod";
import { ORGANIZATION_ID_KEY, STORE_ID_KEY } from "./constants";
import { PromoCode } from "@athena/webapp";

export * from "./productUtils";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Utility function to retrieve the full error object based on its path
export const getErrorForField = (error: ZodError | null, fieldPath: string) => {
  return error?.issues?.find((issue) => issue.path.join(".") === fieldPath);
};

export function capitalizeFirstLetter(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function capitalizeWords(str: string): string {
  return str
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function slugToWords(input: string): string {
  return input.replace(/-/g, " ");
}

export function currencyFormatter(currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

export const formatDate = (date: number) => {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(date));
};

export function getStoreDetails() {
  const storeId = localStorage.getItem(STORE_ID_KEY);
  const organizationId = localStorage.getItem(ORGANIZATION_ID_KEY);

  return { storeId, organizationId };
}

export const enableQuery = () => {
  return Boolean(
    localStorage.getItem(ORGANIZATION_ID_KEY) &&
      localStorage.getItem(STORE_ID_KEY)
  );
};
