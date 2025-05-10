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

export function getRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  const years = Math.floor(months / 12);

  if (years > 0) return `${years} ${years === 1 ? "year" : "years"} ago`;
  if (months > 0) return `${months} ${months === 1 ? "month" : "months"} ago`;
  if (days > 0) return `${days} ${days === 1 ? "day" : "days"} ago`;
  if (hours > 0) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  if (minutes > 0)
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  return "Just now";
}
