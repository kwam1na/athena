import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import View from "../View";
import { FadeIn } from "../common/FadeIn";
import {
  PageLevelHeader,
  PageWorkspace,
  PageWorkspaceGrid,
  PageWorkspaceMain,
  PageWorkspaceRail,
} from "../common/PageLevelHeader";
import { EmptyState } from "../states/empty/empty-state";
import { NoPermissionView } from "../states/no-permission/NoPermissionView";
import { ProtectedAdminSignInView } from "../states/signed-out/ProtectedAdminSignInView";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Textarea } from "../ui/textarea";
import { useProtectedAdminPageState } from "@/hooks/useProtectedAdminPageState";
import {
  type NormalizedCommandResult,
  runCommand,
} from "@/lib/errors/runCommand";
import { presentCommandToast } from "@/lib/errors/presentCommandToast";
import { getOrigin } from "@/lib/navigationUtils";
import { cn, toSlug } from "@/lib/utils";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import { toDisplayAmount } from "~/convex/lib/currency";
import { parseDisplayAmountInput } from "~/src/lib/pos/displayAmounts";
import { currencyDisplaySymbol } from "~/shared/currencyFormatter";

type ServiceCatalogItem = {
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

type ServiceCatalogFormState = {
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

type CreateServiceCatalogArgs = Omit<ServiceCatalogItem, "_id" | "status">;

type UpdateServiceCatalogArgs = Partial<CreateServiceCatalogArgs> & {
  serviceCatalogId: string;
};

const serviceModeLabels: Record<ServiceCatalogItem["serviceMode"], string> = {
  consultation: "Consultation",
  repair: "Repair",
  revamp: "Revamp",
  same_day: "Same-day",
};

const depositTypeLabels: Record<ServiceCatalogItem["depositType"], string> = {
  flat: "Flat deposit",
  none: "No deposit",
  percentage: "Percentage deposit",
};

const serviceStatusLabels: Record<ServiceCatalogItem["status"], string> = {
  active: "Active",
  archived: "Archived",
};

const serviceStatusBadgeClasses: Record<ServiceCatalogItem["status"], string> =
  {
    active: "border-success/30 bg-success/10 text-success",
    archived: "border-border bg-muted/70 text-muted-foreground",
  };

const serviceStatusDotClasses: Record<ServiceCatalogItem["status"], string> = {
  active: "bg-success",
  archived: "bg-muted-foreground",
};

function formatServiceCatalogName(name: string) {
  const trimmedName = name.trim();

  if (!trimmedName) {
    return trimmedName;
  }

  return `${trimmedName[0].toUpperCase()}${trimmedName.slice(1)}`;
}

const initialFormState: ServiceCatalogFormState = {
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

function validateServiceCatalogForm({
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

function itemToFormState(item: ServiceCatalogItem): ServiceCatalogFormState {
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

function parseServiceCatalogForm(
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

type ServiceCatalogViewContentProps = {
  currency: string;
  hasFullAdminAccess: boolean;
  isLoadingPermissions: boolean;
  isSaving: boolean;
  items: ServiceCatalogItem[];
  onArchive: (serviceCatalogId: string) => Promise<void>;
  onCreate: (
    args: CreateServiceCatalogArgs,
  ) => Promise<NormalizedCommandResult<ServiceCatalogItem | null>>;
  servicesWorkspaceHref?: string;
  onUpdate: (
    args: UpdateServiceCatalogArgs,
  ) => Promise<NormalizedCommandResult<ServiceCatalogItem | null>>;
};

export function ServiceCatalogViewContent({
  currency,
  hasFullAdminAccess,
  isLoadingPermissions,
  isSaving,
  items,
  onArchive,
  onCreate,
  servicesWorkspaceHref = "#services-workspace",
  onUpdate,
}: ServiceCatalogViewContentProps) {
  const [form, setForm] = useState<ServiceCatalogFormState>(initialFormState);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const currencySymbol = currencyDisplaySymbol(currency);
  const isDepositValueDisabled = form.depositType === "none";
  const depositValueLabel =
    form.depositType === "percentage"
      ? "Deposit value (%)"
      : form.depositType === "flat"
        ? `Deposit value (${currencySymbol})`
        : "Deposit value";
  const depositValueHelper =
    form.depositType === "percentage"
      ? "Enter the percent of the base price collected before work starts."
      : form.depositType === "flat"
        ? "Enter the fixed amount collected before work starts."
        : "Choose a deposit rule before entering a value.";
  const depositValuePlaceholder =
    form.depositType === "percentage"
      ? "20"
      : form.depositType === "flat"
        ? `${currencySymbol}0.00`
        : "";
  const visibleServiceCatalogItems = items.slice(0, 3);
  const hiddenServiceCatalogItemCount = Math.max(
    items.length - visibleServiceCatalogItems.length,
    0,
  );

  if (isLoadingPermissions) {
    return null;
  }

  if (!hasFullAdminAccess) {
    return <NoPermissionView />;
  }

  const handleChange = <K extends keyof ServiceCatalogFormState>(
    field: K,
    value: ServiceCatalogFormState[K],
  ) => {
    setForm((current) => ({
      ...current,
      [field]: value,
      ...(field === "depositType" && value === "none"
        ? { depositValue: "" }
        : null),
    }));
  };

  const handleEdit = (item: ServiceCatalogItem) => {
    setEditingId(item._id);
    setForm(itemToFormState(item));
    setValidationErrors([]);
  };

  const handleReset = () => {
    setEditingId(null);
    setForm(initialFormState);
    setValidationErrors([]);
  };

  const handleSubmit = async () => {
    const errors = validateServiceCatalogForm({ editingId, form, items });

    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    const parsedForm = parseServiceCatalogForm(form);
    setValidationErrors([]);

    const result = editingId
      ? await onUpdate({
          ...parsedForm,
          serviceCatalogId: editingId,
        })
      : await onCreate(parsedForm);

    if (result.kind !== "ok") {
      setValidationErrors([result.error.message]);
      return;
    }

    toast.success(editingId ? "Service updated" : "Service created");
    handleReset();
  };

  return (
    <View hideBorder hideHeaderBottomBorder scrollMode="page">
      <FadeIn className="container mx-auto py-layout-xl">
        <PageWorkspace>
          <PageLevelHeader
            eyebrow="Service Ops"
            title="Catalog Management"
            description="Maintain the services staff can book or run, including duration, pricing, deposits, and approval rules."
          />

          <PageWorkspaceGrid className="xl:grid-cols-[minmax(0,1fr)_380px]">
            <PageWorkspaceRail>
              <div className="space-y-layout-xl">
                <section className="space-y-layout-lg rounded-lg border border-border bg-surface p-layout-lg shadow-surface">
                  <div className="space-y-1.5 border-b border-border/70 pb-layout-sm">
                    <h3 className="text-xl font-semibold tracking-tight text-foreground">
                      {editingId ? "Edit service" : "Create service"}
                    </h3>
                    <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                      Manage the catalog items staff can book or run as service
                      work.
                    </p>
                  </div>

                  {validationErrors.length > 0 ? (
                    <div className="rounded-lg border border-danger/30 bg-danger/10 px-layout-md py-layout-sm text-sm text-danger">
                      <ul className="list-disc pl-5">
                        {validationErrors.map((error) => (
                          <li key={error}>{error}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="space-y-layout-lg">
                    <div className="space-y-2">
                      <Label htmlFor="service-name">Service name</Label>
                      <Input
                        id="service-name"
                        onChange={(event) =>
                          handleChange("name", event.target.value)
                        }
                        value={form.name}
                      />
                    </div>

                    <div className="grid gap-layout-md sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="service-duration">
                          Duration (minutes)
                        </Label>
                        <Input
                          id="service-duration"
                          inputMode="numeric"
                          onChange={(event) =>
                            handleChange("durationMinutes", event.target.value)
                          }
                          placeholder="90"
                          value={form.durationMinutes}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="service-mode">Service mode</Label>
                        <Select
                          onValueChange={(value) =>
                            handleChange(
                              "serviceMode",
                              value as ServiceCatalogFormState["serviceMode"],
                            )
                          }
                          value={form.serviceMode}
                        >
                          <SelectTrigger
                            aria-label="Service mode"
                            id="service-mode"
                          >
                            <SelectValue placeholder="Select service mode" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="same_day">Same-day</SelectItem>
                            <SelectItem value="consultation">
                              Consultation
                            </SelectItem>
                            <SelectItem value="repair">Repair</SelectItem>
                            <SelectItem value="revamp">Revamp</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="pricing-model">Pricing model</Label>
                        <Select
                          onValueChange={(value) =>
                            handleChange(
                              "pricingModel",
                              value as ServiceCatalogFormState["pricingModel"],
                            )
                          }
                          value={form.pricingModel}
                        >
                          <SelectTrigger
                            aria-label="Pricing model"
                            id="pricing-model"
                          >
                            <SelectValue placeholder="Select pricing model" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="fixed">Fixed</SelectItem>
                            <SelectItem value="starting_at">
                              Starting at
                            </SelectItem>
                            <SelectItem value="quote_after_consultation">
                              Quote after consultation
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="base-price">
                          Base price ({currencySymbol})
                        </Label>
                        <Input
                          id="base-price"
                          inputMode="numeric"
                          onChange={(event) =>
                            handleChange("basePrice", event.target.value)
                          }
                          placeholder={`${currencySymbol}0.00`}
                          value={form.basePrice}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="deposit-rule">Deposit rule</Label>
                        <Select
                          onValueChange={(value) =>
                            handleChange(
                              "depositType",
                              value as ServiceCatalogFormState["depositType"],
                            )
                          }
                          value={form.depositType}
                        >
                          <SelectTrigger
                            aria-label="Deposit rule"
                            id="deposit-rule"
                          >
                            <SelectValue placeholder="Select deposit rule" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No deposit</SelectItem>
                            <SelectItem value="flat">Flat deposit</SelectItem>
                            <SelectItem value="percentage">
                              Percentage deposit
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="deposit-value">
                          {depositValueLabel}
                        </Label>
                        <Input
                          disabled={isDepositValueDisabled}
                          id="deposit-value"
                          inputMode={
                            form.depositType === "percentage"
                              ? "decimal"
                              : "numeric"
                          }
                          onChange={(event) =>
                            handleChange("depositValue", event.target.value)
                          }
                          placeholder={depositValuePlaceholder}
                          value={form.depositValue}
                        />
                        <p className="text-xs leading-5 text-muted-foreground">
                          {depositValueHelper}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="service-description">Description</Label>
                      <Textarea
                        id="service-description"
                        onChange={(event) =>
                          handleChange("description", event.target.value)
                        }
                        value={form.description}
                      />
                    </div>

                    <label className="flex items-center gap-2 text-sm">
                      <input
                        checked={form.requiresManagerApproval}
                        onChange={(event) =>
                          handleChange(
                            "requiresManagerApproval",
                            event.target.checked,
                          )
                        }
                        type="checkbox"
                      />
                      Require manager approval
                    </label>
                  </div>
                </section>

                <div className="flex justify-start gap-3">
                  <Button
                    disabled={isSaving}
                    onClick={handleSubmit}
                    type="button"
                    variant="workflow"
                  >
                    {editingId ? "Save changes" : "Create service"}
                  </Button>
                  {editingId ? (
                    <Button
                      onClick={handleReset}
                      type="button"
                      variant="outline"
                    >
                      Cancel edit
                    </Button>
                  ) : null}
                </div>
              </div>
            </PageWorkspaceRail>

            <PageWorkspaceMain>
              <section className="space-y-layout-lg rounded-lg border border-border bg-surface p-layout-lg shadow-surface">
                <div className="space-y-1.5 border-b border-border/70 pb-layout-md">
                  <h3 className="text-base font-medium">Current services</h3>
                  <p className="text-sm text-muted-foreground">
                    Keep durations, deposits, and approval rules aligned for
                    staff workflows.
                  </p>
                </div>

                {items.length === 0 ? (
                  <div className="py-layout-xl">
                    <EmptyState
                      description="Create the first service item to start booking appointments and cases"
                      title="No service catalog items"
                    />
                  </div>
                ) : (
                  <div className="space-y-layout-md">
                    {visibleServiceCatalogItems.map((item) => (
                      <article
                        className="space-y-layout-md rounded-md border border-border bg-background p-layout-md"
                        key={item._id}
                      >
                        <div className="flex items-start justify-between gap-layout-md">
                          <div className="space-y-1">
                            <p className="font-medium">
                              {formatServiceCatalogName(item.name)}
                            </p>
                            <p className="text-sm leading-6 text-muted-foreground">
                              {[
                                `${item.durationMinutes} min`,
                                serviceModeLabels[item.serviceMode],
                                depositTypeLabels[item.depositType],
                              ].join(" · ")}
                            </p>
                          </div>
                          <span
                            className={cn(
                              "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-semibold uppercase tracking-wide shadow-sm ring-2 ring-background",
                              serviceStatusBadgeClasses[item.status],
                            )}
                          >
                            <span
                              aria-hidden="true"
                              className={cn(
                                "size-1.5 rounded-full",
                                serviceStatusDotClasses[item.status],
                              )}
                            />
                            {serviceStatusLabels[item.status]}
                          </span>
                        </div>

                        <div className="flex gap-2 border-t border-border/70 pt-layout-sm">
                          <Button
                            aria-label={`Edit ${item.name}`}
                            onClick={() => handleEdit(item)}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            Edit
                          </Button>
                          <Button
                            aria-label={`Archive ${item.name}`}
                            onClick={() => onArchive(item._id)}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            Archive
                          </Button>
                        </div>
                      </article>
                    ))}
                    {hiddenServiceCatalogItemCount > 0 ? (
                      <div className="flex items-center justify-between gap-layout-md border-t border-border/70 pt-layout-md">
                        <p className="text-sm text-muted-foreground">
                          {`Showing ${visibleServiceCatalogItems.length} of ${items.length} services.`}
                        </p>
                        <Button
                          asChild
                          size="sm"
                          variant="utility"
                        >
                          <Link
                            aria-label="Open all services workspace"
                            search={{ o: getOrigin() } as never}
                            to={servicesWorkspaceHref as never}
                          >
                            All services
                            <ArrowUpRight aria-hidden="true" />
                          </Link>
                        </Button>
                      </div>
                    ) : null}
                  </div>
                )}
              </section>
            </PageWorkspaceMain>
          </PageWorkspaceGrid>
        </PageWorkspace>
      </FadeIn>
    </View>
  );
}

export function ServiceCatalogView() {
  const {
    activeStore,
    canQueryProtectedData,
    hasFullAdminAccess,
    isAuthenticated,
    isLoadingAccess,
  } = useProtectedAdminPageState();
  const [isSaving, setIsSaving] = useState(false);
  const { orgUrlSlug, storeUrlSlug } = useParams({ strict: false }) as {
    orgUrlSlug?: string;
    storeUrlSlug?: string;
  };
  const servicesWorkspaceHref =
    orgUrlSlug && storeUrlSlug
      ? `/${orgUrlSlug}/store/${storeUrlSlug}/services`
      : "#services-workspace";

  const items = useQuery(
    api.serviceOps.catalog.listServiceCatalogItems,
    canQueryProtectedData ? { storeId: activeStore!._id } : "skip",
  ) as ServiceCatalogItem[] | undefined;

  const createServiceCatalogItem = useMutation(
    api.serviceOps.catalog.createServiceCatalogItem,
  );
  const updateServiceCatalogItem = useMutation(
    api.serviceOps.catalog.updateServiceCatalogItem,
  );
  const archiveServiceCatalogItem = useMutation(
    api.serviceOps.catalog.archiveServiceCatalogItem,
  );

  const withSaveState = async <T,>(action: () => Promise<T>) => {
    setIsSaving(true);
    try {
      return await action();
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoadingAccess) {
    return null;
  }

  if (!isAuthenticated) {
    return (
      <ProtectedAdminSignInView description="Your Athena session needs to reconnect before the service catalog can load protected operations data" />
    );
  }

  if (!hasFullAdminAccess) {
    return <NoPermissionView />;
  }

  if (!activeStore) {
    return (
      <View>
        <div className="container mx-auto py-8">
          <EmptyState
            description="Select a store before opening the service catalog"
            title="No active store"
          />
        </div>
      </View>
    );
  }

  return (
    <ServiceCatalogViewContent
      currency={activeStore.currency}
      hasFullAdminAccess={hasFullAdminAccess}
      isLoadingPermissions={false}
      isSaving={isSaving}
      items={items ?? []}
      onArchive={(serviceCatalogId) =>
        withSaveState(async () => {
          const result = await runCommand(() =>
            archiveServiceCatalogItem({
              serviceCatalogId: serviceCatalogId as Id<"serviceCatalog">,
            }),
          );

          if (result.kind !== "ok") {
            presentCommandToast(result);
            return;
          }

          toast.success("Service archived");
        })
      }
      onCreate={(args) =>
        withSaveState(() =>
          runCommand(() =>
            createServiceCatalogItem({
              ...args,
              storeId: activeStore._id,
            }),
          ),
        )
      }
      servicesWorkspaceHref={servicesWorkspaceHref}
      onUpdate={(args) =>
        withSaveState(() =>
          runCommand(() =>
            updateServiceCatalogItem({
              ...args,
              serviceCatalogId: args.serviceCatalogId as Id<"serviceCatalog">,
            }),
          ),
        )
      }
    />
  );
}
