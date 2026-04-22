import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import View from "../View";
import { FadeIn } from "../common/FadeIn";
import { EmptyState } from "../states/empty/empty-state";
import { NoPermissionView } from "../states/no-permission/NoPermissionView";
import { ProtectedAdminSignInView } from "../states/signed-out/ProtectedAdminSignInView";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { useProtectedAdminPageState } from "@/hooks/useProtectedAdminPageState";
import { api } from "~/convex/_generated/api";

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

function validateServiceCatalogForm(form: ServiceCatalogFormState) {
  const errors: string[] = [];
  const parsedDuration = Number(form.durationMinutes);

  if (!form.name.trim()) {
    errors.push("Service name is required.");
  }

  if (!form.durationMinutes.trim() || Number.isNaN(parsedDuration) || parsedDuration <= 0) {
    errors.push("Duration must be greater than zero.");
  }

  return errors;
}

function itemToFormState(item: ServiceCatalogItem): ServiceCatalogFormState {
  return {
    basePrice: item.basePrice?.toString() ?? "",
    depositType: item.depositType,
    depositValue: item.depositValue?.toString() ?? "",
    description: item.description ?? "",
    durationMinutes: item.durationMinutes.toString(),
    name: item.name,
    pricingModel: item.pricingModel,
    requiresManagerApproval: item.requiresManagerApproval,
    serviceMode: item.serviceMode,
  };
}

function parseServiceCatalogForm(
  form: ServiceCatalogFormState
): CreateServiceCatalogArgs {
  return {
    basePrice: form.basePrice.trim() ? Number(form.basePrice) : undefined,
    depositType: form.depositType,
    depositValue: form.depositValue.trim() ? Number(form.depositValue) : undefined,
    description: form.description.trim() || undefined,
    durationMinutes: Number(form.durationMinutes),
    name: form.name.trim(),
    pricingModel: form.pricingModel,
    requiresManagerApproval: form.requiresManagerApproval,
    serviceMode: form.serviceMode,
  };
}

type ServiceCatalogViewContentProps = {
  hasFullAdminAccess: boolean;
  isLoadingPermissions: boolean;
  isSaving: boolean;
  items: ServiceCatalogItem[];
  onArchive: (serviceCatalogId: string) => Promise<void>;
  onCreate: (args: CreateServiceCatalogArgs) => Promise<void>;
  onUpdate: (args: UpdateServiceCatalogArgs) => Promise<void>;
};

export function ServiceCatalogViewContent({
  hasFullAdminAccess,
  isLoadingPermissions,
  isSaving,
  items,
  onArchive,
  onCreate,
  onUpdate,
}: ServiceCatalogViewContentProps) {
  const [form, setForm] = useState<ServiceCatalogFormState>(initialFormState);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  if (isLoadingPermissions) {
    return (
      <View>
        <div className="container mx-auto py-10 text-sm text-muted-foreground">
          Loading service catalog...
        </div>
      </View>
    );
  }

  if (!hasFullAdminAccess) {
    return <NoPermissionView />;
  }

  const handleChange = <K extends keyof ServiceCatalogFormState>(
    field: K,
    value: ServiceCatalogFormState[K]
  ) => {
    setForm((current) => ({
      ...current,
      [field]: value,
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
    const errors = validateServiceCatalogForm(form);

    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    const parsedForm = parseServiceCatalogForm(form);

    try {
      if (editingId) {
        await onUpdate({
          ...parsedForm,
          serviceCatalogId: editingId,
        });
      } else {
        await onCreate(parsedForm);
      }
      handleReset();
    } catch (error) {
      toast.error("Failed to save service catalog item", {
        description: (error as Error).message,
      });
    }
  };

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      header={
        <div className="container mx-auto flex h-[40px] items-center">
          <p className="text-xl font-medium">Service catalog</p>
        </div>
      }
    >
      <FadeIn className="container mx-auto grid gap-6 py-8 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <section className="space-y-4 rounded-lg border p-4">
          <div>
            <h3 className="text-base font-medium">
              {editingId ? "Edit service" : "Create service"}
            </h3>
            <p className="text-sm text-muted-foreground">
              Manage the catalog items staff can book or run as service work.
            </p>
          </div>

          {validationErrors.length > 0 ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <ul className="list-disc pl-5">
                {validationErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="service-name">Service name</Label>
            <Input
              id="service-name"
              onChange={(event) => handleChange("name", event.target.value)}
              value={form.name}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="service-duration">Duration</Label>
              <Input
                id="service-duration"
                inputMode="numeric"
                onChange={(event) =>
                  handleChange("durationMinutes", event.target.value)
                }
                value={form.durationMinutes}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="service-mode">Service mode</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                id="service-mode"
                onChange={(event) =>
                  handleChange(
                    "serviceMode",
                    event.target.value as ServiceCatalogFormState["serviceMode"]
                  )
                }
                value={form.serviceMode}
              >
                <option value="same_day">Same-day</option>
                <option value="consultation">Consultation</option>
                <option value="repair">Repair</option>
                <option value="revamp">Revamp</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pricing-model">Pricing model</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                id="pricing-model"
                onChange={(event) =>
                  handleChange(
                    "pricingModel",
                    event.target.value as ServiceCatalogFormState["pricingModel"]
                  )
                }
                value={form.pricingModel}
              >
                <option value="fixed">Fixed</option>
                <option value="starting_at">Starting at</option>
                <option value="quote_after_consultation">Quote after consultation</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="base-price">Base price</Label>
              <Input
                id="base-price"
                inputMode="numeric"
                onChange={(event) => handleChange("basePrice", event.target.value)}
                value={form.basePrice}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="deposit-rule">Deposit rule</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                id="deposit-rule"
                onChange={(event) =>
                  handleChange(
                    "depositType",
                    event.target.value as ServiceCatalogFormState["depositType"]
                  )
                }
                value={form.depositType}
              >
                <option value="none">No deposit</option>
                <option value="flat">Flat deposit</option>
                <option value="percentage">Percentage deposit</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="deposit-value">Deposit value</Label>
              <Input
                id="deposit-value"
                inputMode="numeric"
                onChange={(event) => handleChange("depositValue", event.target.value)}
                value={form.depositValue}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="service-description">Description</Label>
            <Textarea
              id="service-description"
              onChange={(event) => handleChange("description", event.target.value)}
              value={form.description}
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              checked={form.requiresManagerApproval}
              onChange={(event) =>
                handleChange("requiresManagerApproval", event.target.checked)
              }
              type="checkbox"
            />
            Require manager approval
          </label>

          <div className="flex gap-3">
            <Button disabled={isSaving} onClick={handleSubmit} type="button">
              {editingId ? "Save changes" : "Create service"}
            </Button>
            {editingId ? (
              <Button onClick={handleReset} type="button" variant="outline">
                Cancel edit
              </Button>
            ) : null}
          </div>
        </section>

        <section className="space-y-3 rounded-lg border p-4">
          <div>
            <h3 className="text-base font-medium">Current services</h3>
            <p className="text-sm text-muted-foreground">
              Keep durations, deposits, and approval rules aligned for staff workflows.
            </p>
          </div>

          {items.length === 0 ? (
            <EmptyState
              description="Create the first service item to start booking appointments and cases."
              title="No service catalog items"
            />
          ) : (
            items.map((item) => (
              <article className="rounded-md border p-3" key={item._id}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {[
                        `${item.durationMinutes} min`,
                        item.serviceMode.replace("_", " "),
                        item.depositType === "none"
                          ? "no deposit"
                          : `${item.depositType} deposit`,
                      ].join(" · ")}
                    </p>
                  </div>
                  <span className="text-xs uppercase text-muted-foreground">
                    {item.status}
                  </span>
                </div>

                <div className="mt-3 flex gap-2">
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
            ))
          )}
        </section>
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

  const items = useQuery(
    api.serviceOps.catalog.listServiceCatalogItems,
    canQueryProtectedData ? { storeId: activeStore!._id } : "skip"
  ) as ServiceCatalogItem[] | undefined;

  const createServiceCatalogItem = useMutation(
    api.serviceOps.catalog.createServiceCatalogItem
  );
  const updateServiceCatalogItem = useMutation(
    api.serviceOps.catalog.updateServiceCatalogItem
  );
  const archiveServiceCatalogItem = useMutation(
    api.serviceOps.catalog.archiveServiceCatalogItem
  );

  const withSaveState = async (action: () => Promise<void>) => {
    setIsSaving(true);
    try {
      await action();
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoadingAccess) {
    return (
      <View>
        <div className="container mx-auto py-10 text-sm text-muted-foreground">
          Loading service catalog...
        </div>
      </View>
    );
  }

  if (!isAuthenticated) {
    return (
      <ProtectedAdminSignInView description="Your Athena session needs to reconnect before the service catalog can load protected operations data." />
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
            description="Select a store before opening the service catalog."
            title="No active store"
          />
        </div>
      </View>
    );
  }

  return (
    <ServiceCatalogViewContent
      hasFullAdminAccess={hasFullAdminAccess}
      isLoadingPermissions={false}
      isSaving={isSaving}
      items={items ?? []}
      onArchive={(serviceCatalogId) =>
        withSaveState(async () => {
          await archiveServiceCatalogItem({ serviceCatalogId: serviceCatalogId as any });
          toast.success("Service archived");
        })
      }
      onCreate={(args) =>
        withSaveState(async () => {
          await createServiceCatalogItem({
            ...args,
            storeId: activeStore._id,
          });
          toast.success("Service created");
        })
      }
      onUpdate={(args) =>
        withSaveState(async () => {
          await updateServiceCatalogItem({
            ...args,
            serviceCatalogId: args.serviceCatalogId as any,
          });
          toast.success("Service updated");
        })
      }
    />
  );
}
