import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { ZodError } from "zod";

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

export function toSlug(str: string) {
  return str
    .toLowerCase() // Convert to lowercase
    .trim() // Trim leading and trailing spaces
    .replace(/[^\w\s-]/g, "") // Remove non-word characters (except space and hyphen)
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/-+/g, "-"); // Replace multiple hyphens with a single hyphen
}

export function slugToWords(input: string): string {
  return input.replace(/-/g, " ");
}

export function snakeCaseToWords(input: string): string {
  return input.replace(/_/g, " ");
}

export function getRelativeTime(timestamp: number) {
  const now = Date.now();
  const diff = now - timestamp; // Difference in milliseconds

  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return rtf.format(-seconds, "seconds");
  if (minutes < 60) return rtf.format(-minutes, "minutes");
  if (hours < 24) return rtf.format(-hours, "hours");
  return rtf.format(-days, "days");
}

// Add the formatUserId function to format user IDs
export const formatUserId = (id: string) => {
  const lastFive = id.slice(-5);
  return `user-${lastFive}`;
};
