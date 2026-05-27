import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { ArrowUpRight, Pencil } from "lucide-react";
import { toast } from "sonner";
import View from "../View";
import { FadeIn } from "../common/FadeIn";
import { ListPagination } from "../common/ListPagination";
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
import { cn } from "@/lib/utils";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import { toDisplayAmount } from "~/convex/lib/currency";
import {
  currencyDisplaySymbol,
  currencyFormatter,
} from "~/shared/currencyFormatter";
import {
  type ServiceCatalogFormState,
  type ServiceCatalogItem,
  type UpdateServiceCatalogArgs,
  depositTypeLabels,
  formatServiceCatalogName,
  initialServiceCatalogFormState,
  itemToServiceCatalogFormState,
  parseServiceCatalogUpdateForm,
  pricingModelLabels,
  serviceModeLabels,
  serviceStatusLabels,
  validateServiceCatalogForm,
} from "./serviceCatalogForm";

const serviceStatusClasses: Record<ServiceCatalogItem["status"], string> = {
  active: "border-success/30 bg-success/10 text-success",
  archived: "border-border bg-muted/70 text-muted-foreground",
};

const SERVICES_PAGE_SIZE = 8;

function formatMoney(currency: string, value?: number) {
  if (value === undefined) {
    return "Not set";
  }

  return currencyFormatter(currency, { minimumFractionDigits: 2 }).format(
    toDisplayAmount(value),
  );
}

function formatDeposit(currency: string, item: ServiceCatalogItem) {
  if (item.depositType === "none") {
    return "No deposit required";
  }

  if (item.depositType === "percentage") {
    return `${item.depositValue ?? 0}% of base price`;
  }

  return `${formatMoney(currency, item.depositValue)} fixed deposit`;
}

function summarizeService(item: ServiceCatalogItem, currency: string) {
  return [
    `${item.durationMinutes} min`,
    serviceModeLabels[item.serviceMode],
    pricingModelLabels[item.pricingModel],
    formatMoney(currency, item.basePrice),
  ].join(" · ");
}

function sortServices(items: ServiceCatalogItem[]) {
  return [...items].sort((first, second) =>
    formatServiceCatalogName(first.name).localeCompare(
      formatServiceCatalogName(second.name),
    ),
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1 rounded-md border border-border bg-background px-layout-md py-layout-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function ServiceEditForm({
  currency,
  form,
  isSaving,
  onCancel,
  onChange,
  onSave,
  validationErrors,
}: {
  currency: string;
  form: ServiceCatalogFormState;
  isSaving: boolean;
  onCancel: () => void;
  onChange: <K extends keyof ServiceCatalogFormState>(
    field: K,
    value: ServiceCatalogFormState[K],
  ) => void;
  onSave: () => void;
  validationErrors: string[];
}) {
  const currencySymbol = currencyDisplaySymbol(currency);
  const isDepositValueDisabled = form.depositType === "none";
  const depositValueLabel =
    form.depositType === "percentage"
      ? "Deposit value (%)"
      : form.depositType === "flat"
        ? `Deposit value (${currencySymbol})`
        : "Deposit value";
  const depositValuePlaceholder =
    form.depositType === "percentage"
      ? "20"
      : form.depositType === "flat"
        ? `${currencySymbol}0.00`
        : "";

  return (
    <div className="space-y-layout-lg">
      {validationErrors.length > 0 ? (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-layout-md py-layout-sm text-sm text-danger">
          <ul className="list-disc pl-5">
            {validationErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-layout-md">
        <div className="space-y-2">
          <Label htmlFor="service-edit-name">Service name</Label>
          <Input
            id="service-edit-name"
            onChange={(event) => onChange("name", event.target.value)}
            value={form.name}
          />
        </div>

        <div className="grid gap-layout-md sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="service-edit-duration">Duration (minutes)</Label>
            <Input
              id="service-edit-duration"
              inputMode="numeric"
              onChange={(event) =>
                onChange("durationMinutes", event.target.value)
              }
              value={form.durationMinutes}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="service-edit-mode">Service mode</Label>
            <Select
              onValueChange={(value) =>
                onChange(
                  "serviceMode",
                  value as ServiceCatalogFormState["serviceMode"],
                )
              }
              value={form.serviceMode}
            >
              <SelectTrigger aria-label="Service mode" id="service-edit-mode">
                <SelectValue placeholder="Select service mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="same_day">Same-day</SelectItem>
                <SelectItem value="consultation">Consultation</SelectItem>
                <SelectItem value="repair">Repair</SelectItem>
                <SelectItem value="revamp">Revamp</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="service-edit-pricing">Pricing model</Label>
            <Select
              onValueChange={(value) =>
                onChange(
                  "pricingModel",
                  value as ServiceCatalogFormState["pricingModel"],
                )
              }
              value={form.pricingModel}
            >
              <SelectTrigger
                aria-label="Pricing model"
                id="service-edit-pricing"
              >
                <SelectValue placeholder="Select pricing model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed">Fixed</SelectItem>
                <SelectItem value="starting_at">Starting at</SelectItem>
                <SelectItem value="quote_after_consultation">
                  Quote after consultation
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="service-edit-base-price">
              Base price ({currencySymbol})
            </Label>
            <Input
              id="service-edit-base-price"
              inputMode="numeric"
              onChange={(event) => onChange("basePrice", event.target.value)}
              placeholder={`${currencySymbol}0.00`}
              value={form.basePrice}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="service-edit-deposit-rule">Deposit rule</Label>
            <Select
              onValueChange={(value) =>
                onChange(
                  "depositType",
                  value as ServiceCatalogFormState["depositType"],
                )
              }
              value={form.depositType}
            >
              <SelectTrigger
                aria-label="Deposit rule"
                id="service-edit-deposit-rule"
              >
                <SelectValue placeholder="Select deposit rule" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No deposit</SelectItem>
                <SelectItem value="flat">Flat deposit</SelectItem>
                <SelectItem value="percentage">Percentage deposit</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="service-edit-deposit-value">
              {depositValueLabel}
            </Label>
            <Input
              disabled={isDepositValueDisabled}
              id="service-edit-deposit-value"
              inputMode={
                form.depositType === "percentage" ? "decimal" : "numeric"
              }
              onChange={(event) => onChange("depositValue", event.target.value)}
              placeholder={depositValuePlaceholder}
              value={form.depositValue}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="service-edit-description">Description</Label>
          <Textarea
            id="service-edit-description"
            onChange={(event) => onChange("description", event.target.value)}
            value={form.description}
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            checked={form.requiresManagerApproval}
            onChange={(event) =>
              onChange("requiresManagerApproval", event.target.checked)
            }
            type="checkbox"
          />
          Require manager approval
        </label>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button
          disabled={isSaving}
          onClick={onSave}
          type="button"
          variant="workflow"
        >
          Save changes
        </Button>
        <Button onClick={onCancel} type="button" variant="outline">
          Cancel
        </Button>
      </div>
    </div>
  );
}

type ServicesWorkspaceViewContentProps = {
  catalogManagementHref?: string;
  currency: string;
  isSaving?: boolean;
  items: ServiceCatalogItem[];
  onUpdate?: (
    args: UpdateServiceCatalogArgs,
  ) => Promise<NormalizedCommandResult<ServiceCatalogItem | null>>;
};

export function ServicesWorkspaceViewContent({
  catalogManagementHref = "#catalog-management",
  currency,
  isSaving = false,
  items,
  onUpdate,
}: ServicesWorkspaceViewContentProps) {
  const [query, setQuery] = useState("");
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(
    null,
  );
  const [page, setPage] = useState(1);
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<ServiceCatalogFormState>(
    initialServiceCatalogFormState,
  );
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const sortedItems = useMemo(() => sortServices(items), [items]);
  const activeServices = useMemo(
    () => sortedItems.filter((item) => item.status === "active"),
    [sortedItems],
  );
  const servicesRequiringApproval = useMemo(
    () => sortedItems.filter((item) => item.requiresManagerApproval),
    [sortedItems],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const filteredItems = useMemo(
    () =>
      normalizedQuery
        ? sortedItems.filter((item) =>
            [
              item.name,
              serviceModeLabels[item.serviceMode],
              pricingModelLabels[item.pricingModel],
              depositTypeLabels[item.depositType],
            ]
              .join(" ")
              .toLowerCase()
              .includes(normalizedQuery),
          )
        : sortedItems,
    [normalizedQuery, sortedItems],
  );
  const pageCount = Math.max(
    1,
    Math.ceil(filteredItems.length / SERVICES_PAGE_SIZE),
  );
  const clampedPage = Math.min(page, pageCount);
  const paginatedItems = useMemo(() => {
    const start = (clampedPage - 1) * SERVICES_PAGE_SIZE;

    return filteredItems.slice(start, start + SERVICES_PAGE_SIZE);
  }, [clampedPage, filteredItems]);
  const selectedService =
    paginatedItems.find((item) => item._id === selectedServiceId) ??
    paginatedItems[0] ??
    null;

  useEffect(() => {
    setPage(1);
  }, [normalizedQuery]);

  useEffect(() => {
    if (page <= pageCount) {
      return;
    }

    setPage(pageCount);
  }, [page, pageCount]);

  useEffect(() => {
    if (
      selectedServiceId &&
      paginatedItems.some((item) => item._id === selectedServiceId)
    ) {
      return;
    }

    setSelectedServiceId(paginatedItems[0]?._id ?? null);
  }, [paginatedItems, selectedServiceId]);

  useEffect(() => {
    setIsEditing(false);
    setForm(initialServiceCatalogFormState);
    setValidationErrors([]);
  }, [selectedServiceId]);

  const handleSelectService = (serviceCatalogId: string) => {
    setSelectedServiceId(serviceCatalogId);
  };

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

  const handleEdit = () => {
    if (!selectedService) {
      return;
    }

    setForm(itemToServiceCatalogFormState(selectedService));
    setValidationErrors([]);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setForm(initialServiceCatalogFormState);
    setValidationErrors([]);
  };

  const handleSaveEdit = async () => {
    if (!selectedService || !onUpdate) {
      return;
    }

    const errors = validateServiceCatalogForm({
      editingId: selectedService._id,
      form,
      items,
    });

    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    setValidationErrors([]);
    const result = await onUpdate(
      parseServiceCatalogUpdateForm(form, selectedService._id),
    );

    if (result.kind !== "ok") {
      setValidationErrors([result.error.message]);
      return;
    }

    toast.success("Service updated");
    handleCancelEdit();
  };

  return (
    <View hideBorder hideHeaderBottomBorder scrollMode="page">
      <FadeIn className="container mx-auto py-layout-xl">
        <PageWorkspace>
          <PageLevelHeader
            eyebrow="Service Ops"
            showBackButton
            title="Services"
            description="Review service definitions, pricing, deposits, and approval rules before staff book or run the work."
          />

          <div className="grid gap-layout-md sm:grid-cols-3">
            <DetailRow label="Total services" value={String(sortedItems.length)} />
            <DetailRow
              label="Active"
              value={String(activeServices.length)}
            />
            <DetailRow
              label="Manager approval"
              value={String(servicesRequiringApproval.length)}
            />
          </div>

          <PageWorkspaceGrid className="xl:grid-cols-[minmax(0,1fr)_380px]">
            <PageWorkspaceMain>
              <section
                aria-labelledby="service-directory-heading"
                className="space-y-layout-lg rounded-lg border border-border bg-surface p-layout-lg shadow-surface"
              >
                <div className="flex flex-col gap-layout-md border-b border-border/70 pb-layout-md md:flex-row md:items-start md:justify-between">
                  <div className="space-y-1.5">
                    <h3
                      className="text-xl font-semibold tracking-tight text-foreground"
                      id="service-directory-heading"
                    >
                      Service directory
                    </h3>
                    <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                      Scan the available service work and open a service for
                      pricing, deposit, and workflow details.
                    </p>
                  </div>
                  <Button asChild size="sm" variant="utility">
                    <Link to={catalogManagementHref as never}>
                      Manage catalog
                      <ArrowUpRight aria-hidden="true" />
                    </Link>
                  </Button>
                </div>

                <Input
                  aria-label="Search services"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search by name, mode, pricing, or deposit"
                  value={query}
                />

                {filteredItems.length === 0 ? (
                  <div className="py-layout-xl">
                    <EmptyState
                      description="Adjust the search or add a service in catalog management."
                      title="No services found"
                    />
                  </div>
                ) : (
                  <>
                    <div className="grid gap-layout-md lg:grid-cols-2">
                      {paginatedItems.map((item) => {
                        const isSelected = selectedService?._id === item._id;

                        return (
                          <button
                            className={cn(
                              "space-y-layout-md rounded-md border border-border bg-background p-layout-md text-left transition-colors hover:border-action-neutral focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                              isSelected
                                ? "border-action-workflow bg-action-workflow-soft/40"
                                : null,
                            )}
                            key={item._id}
                            onClick={() => handleSelectService(item._id)}
                            type="button"
                          >
                            <div className="flex items-start justify-between gap-layout-md">
                              <div className="space-y-1">
                                <p className="font-medium">
                                  {formatServiceCatalogName(item.name)}
                                </p>
                                <p className="text-sm leading-6 text-muted-foreground">
                                  {summarizeService(item, currency)}
                                </p>
                              </div>
                              <span
                                className={cn(
                                  "inline-flex h-6 shrink-0 items-center rounded-md border px-2.5 text-[11px] font-semibold uppercase tracking-wide",
                                  serviceStatusClasses[item.status],
                                )}
                              >
                                {serviceStatusLabels[item.status]}
                              </span>
                            </div>
                            <p className="border-t border-border/70 pt-layout-sm text-sm text-muted-foreground">
                              {formatDeposit(currency, item)}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                    {filteredItems.length > SERVICES_PAGE_SIZE ? (
                      <ListPagination
                        onPageChange={setPage}
                        page={clampedPage}
                        pageCount={pageCount}
                        pageSize={SERVICES_PAGE_SIZE}
                        totalItems={filteredItems.length}
                      />
                    ) : null}
                  </>
                )}
              </section>
            </PageWorkspaceMain>

            <PageWorkspaceRail>
              <section className="space-y-layout-lg rounded-lg border border-border bg-surface p-layout-lg shadow-surface">
                <div className="space-y-1.5 border-b border-border/70 pb-layout-md">
                  <h3 className="text-base font-medium">Service details</h3>
                  <p className="text-sm text-muted-foreground">
                    Selected service configuration for staff workflows.
                  </p>
                </div>

                {!selectedService ? (
                  <EmptyState
                    description="Choose a service to review its details."
                    title="No service selected"
                  />
                ) : isEditing ? (
                  <ServiceEditForm
                    currency={currency}
                    form={form}
                    isSaving={isSaving}
                    onCancel={handleCancelEdit}
                    onChange={handleChange}
                    onSave={handleSaveEdit}
                    validationErrors={validationErrors}
                  />
                ) : (
                  <div className="space-y-layout-md">
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-layout-md">
                        <div>
                          <h4 className="text-lg font-semibold tracking-tight text-foreground">
                            {formatServiceCatalogName(selectedService.name)}
                          </h4>
                          <p className="text-sm text-muted-foreground">
                            {selectedService.description || "No description"}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "inline-flex h-6 shrink-0 items-center rounded-md border px-2.5 text-[11px] font-semibold uppercase tracking-wide",
                            serviceStatusClasses[selectedService.status],
                          )}
                        >
                          {serviceStatusLabels[selectedService.status]}
                        </span>
                      </div>
                    </div>

                    <div className="grid gap-layout-sm">
                      <DetailRow
                        label="Duration"
                        value={`${selectedService.durationMinutes} minutes`}
                      />
                      <DetailRow
                        label="Service mode"
                        value={serviceModeLabels[selectedService.serviceMode]}
                      />
                      <DetailRow
                        label="Pricing"
                        value={`${pricingModelLabels[selectedService.pricingModel]} · ${formatMoney(currency, selectedService.basePrice)}`}
                      />
                      <DetailRow
                        label="Deposit"
                        value={formatDeposit(currency, selectedService)}
                      />
                      <DetailRow
                        label="Approval"
                        value={
                          selectedService.requiresManagerApproval
                            ? "Manager approval required"
                            : "No manager approval"
                        }
                      />
                    </div>

                    {onUpdate ? (
                      <Button
                        className="w-full justify-center"
                        onClick={handleEdit}
                        type="button"
                        variant="workflow"
                      >
                        <Pencil aria-hidden="true" />
                        Edit service
                      </Button>
                    ) : null}
                  </div>
                )}
              </section>
            </PageWorkspaceRail>
          </PageWorkspaceGrid>
        </PageWorkspace>
      </FadeIn>
    </View>
  );
}

export function ServicesWorkspaceView() {
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
  const items = useQuery(
    api.serviceOps.catalog.listServiceCatalogItems,
    canQueryProtectedData && activeStore?._id
      ? { storeId: activeStore._id }
      : "skip",
  ) as ServiceCatalogItem[] | undefined;
  const updateServiceCatalogItem = useMutation(
    api.serviceOps.catalog.updateServiceCatalogItem,
  );
  const catalogManagementHref =
    orgUrlSlug && storeUrlSlug
      ? `/${orgUrlSlug}/store/${storeUrlSlug}/services/catalog-management`
      : "#catalog-management";
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
      <ProtectedAdminSignInView description="Your Athena session needs to reconnect before services can load protected operations data" />
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
            description="Select a store before opening services"
            title="No active store"
          />
        </div>
      </View>
    );
  }

  return (
    <ServicesWorkspaceViewContent
      catalogManagementHref={catalogManagementHref}
      currency={activeStore.currency}
      isSaving={isSaving}
      items={items ?? []}
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
