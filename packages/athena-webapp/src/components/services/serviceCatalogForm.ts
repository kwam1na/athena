import { toDisplayAmount } from "~/convex/lib/currency";
import { parseDisplayAmountInput } from "~/src/lib/pos/displayAmounts";
import { toSlug } from "@/lib/utils";

export type ServiceCatalogItem = {
  _id: string;
  basePrice?: number;
  depositType: "none" | "flat" | "percentage";
  depositValue?: number;
  description?: string;
  durationMinutes: number;
  name: string;
  pricingModel: "fixed" | "starting_at" | "quote_after_consultation";
  requiresManagerApproval: boolean;
  serviceMode: "same_day" | "consultation" | "repair" | "revamp";
  status: "active" | "archived";
};

export type ServiceCatalogFormState = {
  basePrice: string;
  depositType: "none" | "flat" | "percentage";
  depositValue: string;
  description: string;
  durationMinutes: string;
  name: string;
  pricingModel: "fixed" | "starting_at" | "quote_after_consultation";
  requiresManagerApproval: boolean;
  serviceMode: "same_day" | "consultation" | "repair" | "revamp";
};

export type CreateServiceCatalogArgs = Omit<
  ServiceCatalogItem,
  "_id" | "status"
>;

export type UpdateServiceCatalogArgs = Omit<
  CreateServiceCatalogArgs,
  "basePrice" | "depositValue" | "description"
> & {
  basePrice?: number | null;
  depositValue?: number | null;
  description?: string | null;
  serviceCatalogId: string;
};

export const serviceModeLabels: Record<
  ServiceCatalogItem["serviceMode"],
  string
> = {
  consultation: "Consultation",
  repair: "Repair",
  revamp: "Revamp",
  same_day: "Same-day",
};

export const pricingModelLabels: Record<
  ServiceCatalogItem["pricingModel"],
  string
> = {
  fixed: "Fixed price",
  quote_after_consultation: "Quote after consultation",
  starting_at: "Starting at",
};

export const depositTypeLabels: Record<
  ServiceCatalogItem["depositType"],
  string
> = {
  flat: "Flat deposit",
  none: "No deposit",
  percentage: "Percentage deposit",
};

export const serviceStatusLabels: Record<ServiceCatalogItem["status"], string> =
  {
    active: "Active",
    archived: "Archived",
  };

export const initialServiceCatalogFormState: ServiceCatalogFormState = {
  basePrice: "",
  depositType: "none",
  depositValue: "",
  description: "",
  durationMinutes: "",
  name: "",
  pricingModel: "fixed",
  requiresManagerApproval: false,
  serviceMode: "same_day",
};

export function formatServiceCatalogName(name: string) {
  const trimmedName = name.trim();

  if (!trimmedName) {
    return trimmedName;
  }

  return `${trimmedName[0].toUpperCase()}${trimmedName.slice(1)}`;
}

export function validateServiceCatalogForm({
  editingId,
  form,
  items,
}: {
  editingId: string | null;
  form: ServiceCatalogFormState;
  items: ServiceCatalogItem[];
}) {
  const errors: string[] = [];
  const parsedDuration = Number(form.durationMinutes);
  const serviceNameKey = toSlug(form.name);

  if (!form.name.trim()) {
    errors.push("Service name is required");
  }

  if (
    serviceNameKey &&
    items.some(
      (item) => item._id !== editingId && toSlug(item.name) === serviceNameKey,
    )
  ) {
    errors.push("A service catalog item with this name already exists.");
  }

  if (
    !form.durationMinutes.trim() ||
    Number.isNaN(parsedDuration) ||
    parsedDuration <= 0
  ) {
    errors.push("Duration must be greater than zero");
  }

  if (
    form.basePrice.trim() &&
    parseDisplayAmountInput(form.basePrice) === undefined
  ) {
    errors.push("Base price must be a valid amount");
  }

  if (
    form.depositValue.trim() &&
    form.depositType === "flat" &&
    parseDisplayAmountInput(form.depositValue) === undefined
  ) {
    errors.push("Deposit value must be a valid amount");
  }

  return errors;
}

export function itemToServiceCatalogFormState(
  item: ServiceCatalogItem,
): ServiceCatalogFormState {
  return {
    basePrice:
      item.basePrice === undefined
        ? ""
        : toDisplayAmount(item.basePrice).toString(),
    depositType: item.depositType,
    depositValue:
      item.depositValue === undefined
        ? ""
        : item.depositType === "flat"
          ? toDisplayAmount(item.depositValue).toString()
          : item.depositValue.toString(),
    description: item.description ?? "",
    durationMinutes: item.durationMinutes.toString(),
    name: item.name,
    pricingModel: item.pricingModel,
    requiresManagerApproval: item.requiresManagerApproval,
    serviceMode: item.serviceMode,
  };
}

export function parseServiceCatalogCreateForm(
  form: ServiceCatalogFormState,
): CreateServiceCatalogArgs {
  const basePrice = form.basePrice.trim()
    ? parseDisplayAmountInput(form.basePrice)
    : undefined;
  const depositValue = form.depositValue.trim()
    ? form.depositType === "percentage"
      ? Number(form.depositValue)
      : parseDisplayAmountInput(form.depositValue)
    : undefined;

  return {
    basePrice,
    depositType: form.depositType,
    depositValue,
    description: form.description.trim() || undefined,
    durationMinutes: Number(form.durationMinutes),
    name: form.name.trim(),
    pricingModel: form.pricingModel,
    requiresManagerApproval: form.requiresManagerApproval,
    serviceMode: form.serviceMode,
  };
}

export function parseServiceCatalogUpdateForm(
  form: ServiceCatalogFormState,
  serviceCatalogId: string,
): UpdateServiceCatalogArgs {
  const parsedForm = parseServiceCatalogCreateForm(form);

  return {
    ...parsedForm,
    basePrice: parsedForm.basePrice ?? null,
    depositValue: parsedForm.depositValue ?? null,
    description: parsedForm.description ?? null,
    serviceCatalogId,
  };
}
