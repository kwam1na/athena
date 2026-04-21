import { useDeferredValue, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import View from "../View";
import { FadeIn } from "../common/FadeIn";
import { EmptyState } from "../states/empty/empty-state";
import { NoPermissionView } from "../states/no-permission/NoPermissionView";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { usePermissions } from "@/hooks/usePermissions";
import { api } from "~/convex/_generated/api";

type CustomerResult = {
  _id: string;
  fullName: string;
};

type StaffOption = {
  _id: string;
  fullName: string;
  roles: string[];
};

type CatalogItem = {
  _id: string;
  name: string;
  serviceMode: "same_day" | "consultation" | "repair" | "revamp";
};

type ServiceCaseListItem = {
  _id: string;
  balanceDueAmount: number;
  customerName?: string | null;
  paymentStatus: string;
  pendingApprovalCount: number;
  serviceCatalogName?: string | null;
  staffName?: string | null;
  status: string;
};

type ServiceCaseDetails = {
  _id: string;
  balanceDueAmount: number;
  lineItems: Array<unknown>;
  paymentAllocations: Array<unknown>;
  paymentStatus: string;
  pendingApprovals: Array<{ _id: string }>;
  status: string;
};

type CreateServiceCaseArgs = {
  assignedStaffProfileId: string;
  customerProfileId: string;
  quotedAmount?: number;
  serviceCatalogId?: string;
  serviceMode: "same_day" | "consultation" | "repair" | "revamp";
  title: string;
};

type ServiceCasesViewContentProps = {
  catalogItems: CatalogItem[];
  customerResults: CustomerResult[];
  hasFullAdminAccess: boolean;
  isLoadingPermissions: boolean;
  isSaving: boolean;
  onAddLineItem: (args: {
    description: string;
    lineType: "labor" | "material" | "adjustment";
    quantity: number;
    serviceCaseId: string;
    unitPrice: number;
  }) => Promise<void>;
  onCreateCase: (args: CreateServiceCaseArgs) => Promise<void>;
  onRecordInventoryUsage: (args: {
    productSkuId: string;
    quantity: number;
    serviceCaseId: string;
    usageType: "consumed";
  }) => Promise<void>;
  onRecordPayment: (args: {
    amount: number;
    method: string;
    serviceCaseId: string;
  }) => Promise<void>;
  onUpdateStatus: (args: {
    serviceCaseId: string;
    status: string;
  }) => Promise<void>;
  searchQuery: string;
  selectedCaseDetails: ServiceCaseDetails | null;
  selectedCaseId: string | null;
  serviceCases: ServiceCaseListItem[];
  setSearchQuery: (value: string) => void;
  setSelectedCaseId: (value: string) => void;
  staffOptions: StaffOption[];
};

const initialCreateForm = {
  assignedStaffProfileId: "",
  quotedAmount: "",
  selectedCustomerId: "",
  serviceCatalogId: "",
  serviceMode: "same_day" as CreateServiceCaseArgs["serviceMode"],
  title: "",
};

const initialPaymentForm = {
  amount: "",
  method: "cash",
};

const initialLineItemForm = {
  description: "",
  lineType: "labor" as const,
  quantity: "",
  unitPrice: "",
};

const initialInventoryForm = {
  productSkuId: "",
  quantity: "",
};

export function ServiceCasesViewContent({
  catalogItems,
  customerResults,
  hasFullAdminAccess,
  isLoadingPermissions,
  isSaving,
  onAddLineItem,
  onCreateCase,
  onRecordInventoryUsage,
  onRecordPayment,
  onUpdateStatus,
  searchQuery,
  selectedCaseDetails,
  selectedCaseId,
  serviceCases,
  setSearchQuery,
  setSelectedCaseId,
  staffOptions,
}: ServiceCasesViewContentProps) {
  const [createForm, setCreateForm] = useState(initialCreateForm);
  const [lineItemForm, setLineItemForm] = useState(initialLineItemForm);
  const [inventoryForm, setInventoryForm] = useState(initialInventoryForm);
  const [paymentForm, setPaymentForm] = useState(initialPaymentForm);
  const [statusValue, setStatusValue] = useState("in_progress");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const selectedCaseSummary = useMemo(
    () => serviceCases.find((serviceCase) => serviceCase._id === selectedCaseId) ?? null,
    [selectedCaseId, serviceCases]
  );

  if (isLoadingPermissions) {
    return (
      <View>
        <div className="container mx-auto py-10 text-sm text-muted-foreground">
          Loading service cases...
        </div>
      </View>
    );
  }

  if (!hasFullAdminAccess) {
    return <NoPermissionView />;
  }

  const handleCreateCase = async () => {
    const errors: string[] = [];

    if (!createForm.selectedCustomerId) {
      errors.push("Select a customer.");
    }

    if (!createForm.title.trim()) {
      errors.push("Provide a service title.");
    }

    if (!createForm.assignedStaffProfileId) {
      errors.push("Select a staff member.");
    }

    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    try {
      await onCreateCase({
        assignedStaffProfileId: createForm.assignedStaffProfileId,
        customerProfileId: createForm.selectedCustomerId,
        quotedAmount: createForm.quotedAmount.trim()
          ? Number(createForm.quotedAmount)
          : undefined,
        serviceCatalogId: createForm.serviceCatalogId || undefined,
        serviceMode: createForm.serviceMode,
        title: createForm.title.trim(),
      });
      setCreateForm(initialCreateForm);
      setSearchQuery("");
      setValidationErrors([]);
    } catch (error) {
      toast.error("Failed to create service case", {
        description: (error as Error).message,
      });
    }
  };

  const activeServiceCaseId = selectedCaseDetails?._id ?? selectedCaseId;

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      header={
        <div className="container mx-auto flex h-[40px] items-center">
          <p className="text-xl font-medium">Active service cases</p>
        </div>
      }
    >
      <FadeIn className="container mx-auto grid gap-6 py-8 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <section className="space-y-4 rounded-lg border p-4">
          <div>
            <h3 className="text-base font-medium">Create walk-in case</h3>
            <p className="text-sm text-muted-foreground">
              Start same-day, consultation, repair, or revamp work from one place.
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
            <Label htmlFor="case-search">Search existing customers</Label>
            <Input
              id="case-search"
              onChange={(event) => setSearchQuery(event.target.value)}
              value={searchQuery}
            />
          </div>

          {customerResults.length > 0 ? (
            <div className="space-y-2 rounded-md border bg-muted/20 p-3">
              {customerResults.map((customer) => (
                <button
                  className="flex w-full items-center justify-between rounded-md border bg-background px-3 py-2 text-left"
                  key={customer._id}
                  onClick={() =>
                    setCreateForm((current) => ({
                      ...current,
                      selectedCustomerId: customer._id,
                    }))
                  }
                  type="button"
                >
                  <span>{customer.fullName}</span>
                  <span className="text-xs text-muted-foreground">Use customer</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="case-title">Service title</Label>
            <Input
              id="case-title"
              onChange={(event) =>
                setCreateForm((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              value={createForm.title}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="case-service-mode">Service mode</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                id="case-service-mode"
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    serviceMode: event.target.value as CreateServiceCaseArgs["serviceMode"],
                  }))
                }
                value={createForm.serviceMode}
              >
                <option value="same_day">Same-day</option>
                <option value="consultation">Consultation</option>
                <option value="repair">Repair</option>
                <option value="revamp">Revamp</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="case-service-catalog">Service catalog</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                id="case-service-catalog"
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    serviceCatalogId: event.target.value,
                  }))
                }
                value={createForm.serviceCatalogId}
              >
                <option value="">Optional catalog item</option>
                {catalogItems.map((item) => (
                  <option key={item._id} value={item._id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="case-assigned-staff">Assigned staff</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                id="case-assigned-staff"
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    assignedStaffProfileId: event.target.value,
                  }))
                }
                value={createForm.assignedStaffProfileId}
              >
                <option value="">Select staff member</option>
                {staffOptions.map((staff) => (
                  <option key={staff._id} value={staff._id}>
                    {staff.fullName}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="case-quoted-amount">Quoted amount</Label>
              <Input
                id="case-quoted-amount"
                inputMode="numeric"
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    quotedAmount: event.target.value,
                  }))
                }
                value={createForm.quotedAmount}
              />
            </div>
          </div>

          <Button disabled={isSaving} onClick={handleCreateCase} type="button">
            Create service case
          </Button>
        </section>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
          <div className="space-y-3 rounded-lg border p-4">
            <div>
              <h3 className="text-base font-medium">Live cases</h3>
              <p className="text-sm text-muted-foreground">
                Review assignment, payment state, and approval pressure at a glance.
              </p>
            </div>

            {serviceCases.length === 0 ? (
              <EmptyState
                description="Service cases will appear here once work is created."
                title="No active cases"
              />
            ) : (
              serviceCases.map((serviceCase) => (
                <button
                  className={`w-full rounded-md border p-3 text-left ${
                    serviceCase._id === selectedCaseId ? "border-primary" : ""
                  }`}
                  key={serviceCase._id}
                  onClick={() => setSelectedCaseId(serviceCase._id)}
                  type="button"
                >
                  <p className="font-medium">
                    {serviceCase.serviceCatalogName ?? "Service case"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {[serviceCase.customerName, serviceCase.staffName]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {serviceCase.paymentStatus} · balance {serviceCase.balanceDueAmount}
                  </p>
                </button>
              ))
            )}
          </div>

          <div className="space-y-4 rounded-lg border p-4">
            {!selectedCaseSummary || !activeServiceCaseId ? (
              <EmptyState
                description="Choose a case to review details and run service actions."
                title="No case selected"
              />
            ) : (
              <>
                <div>
                  <h3 className="text-base font-medium">
                    {selectedCaseSummary.serviceCatalogName ?? "Service case"}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {[selectedCaseSummary.customerName, selectedCaseSummary.staffName]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span>{selectedCaseSummary.paymentStatus}</span>
                    <span>balance {selectedCaseSummary.balanceDueAmount}</span>
                    <span>{selectedCaseSummary.pendingApprovalCount} pending approval</span>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <section className="space-y-3 rounded-md border p-3">
                    <h4 className="font-medium">Payments</h4>
                    <div className="space-y-2">
                      <Label htmlFor="payment-amount">Payment amount</Label>
                      <Input
                        id="payment-amount"
                        inputMode="numeric"
                        onChange={(event) =>
                          setPaymentForm((current) => ({
                            ...current,
                            amount: event.target.value,
                          }))
                        }
                        value={paymentForm.amount}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="payment-method">Payment method</Label>
                      <select
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        id="payment-method"
                        onChange={(event) =>
                          setPaymentForm((current) => ({
                            ...current,
                            method: event.target.value,
                          }))
                        }
                        value={paymentForm.method}
                      >
                        <option value="cash">Cash</option>
                        <option value="card">Card</option>
                        <option value="mobile_money">Mobile money</option>
                      </select>
                    </div>
                    <Button
                      onClick={() =>
                        onRecordPayment({
                          amount: Number(paymentForm.amount),
                          method: paymentForm.method,
                          serviceCaseId: activeServiceCaseId,
                        })
                      }
                      type="button"
                      variant="outline"
                    >
                      Record payment
                    </Button>
                  </section>

                  <section className="space-y-3 rounded-md border p-3">
                    <h4 className="font-medium">Case status</h4>
                    <div className="space-y-2">
                      <Label htmlFor="case-status">Case status</Label>
                      <select
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        id="case-status"
                        onChange={(event) => setStatusValue(event.target.value)}
                        value={statusValue}
                      >
                        <option value="in_progress">In progress</option>
                        <option value="awaiting_approval">Awaiting approval</option>
                        <option value="awaiting_pickup">Awaiting pickup</option>
                        <option value="completed">Completed</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                    </div>
                    <Button
                      onClick={() =>
                        onUpdateStatus({
                          serviceCaseId: activeServiceCaseId,
                          status: statusValue,
                        })
                      }
                      type="button"
                      variant="outline"
                    >
                      Update status
                    </Button>
                  </section>

                  <section className="space-y-3 rounded-md border p-3">
                    <h4 className="font-medium">Line items</h4>
                    <div className="space-y-2">
                      <Label htmlFor="line-item-description">Line item description</Label>
                      <Input
                        id="line-item-description"
                        onChange={(event) =>
                          setLineItemForm((current) => ({
                            ...current,
                            description: event.target.value,
                          }))
                        }
                        value={lineItemForm.description}
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="space-y-2">
                        <Label htmlFor="line-item-quantity">Line item quantity</Label>
                        <Input
                          id="line-item-quantity"
                          inputMode="numeric"
                          onChange={(event) =>
                            setLineItemForm((current) => ({
                              ...current,
                              quantity: event.target.value,
                            }))
                          }
                          value={lineItemForm.quantity}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="line-item-unit-price">Line item unit price</Label>
                        <Input
                          id="line-item-unit-price"
                          inputMode="numeric"
                          onChange={(event) =>
                            setLineItemForm((current) => ({
                              ...current,
                              unitPrice: event.target.value,
                            }))
                          }
                          value={lineItemForm.unitPrice}
                        />
                      </div>
                    </div>
                    <Button
                      onClick={() =>
                        onAddLineItem({
                          description: lineItemForm.description,
                          lineType: lineItemForm.lineType,
                          quantity: Number(lineItemForm.quantity),
                          serviceCaseId: activeServiceCaseId,
                          unitPrice: Number(lineItemForm.unitPrice),
                        })
                      }
                      type="button"
                      variant="outline"
                    >
                      Add line item
                    </Button>
                  </section>

                  <section className="space-y-3 rounded-md border p-3">
                    <h4 className="font-medium">Materials</h4>
                    <div className="space-y-2">
                      <Label htmlFor="material-sku">Material SKU</Label>
                      <Input
                        id="material-sku"
                        onChange={(event) =>
                          setInventoryForm((current) => ({
                            ...current,
                            productSkuId: event.target.value,
                          }))
                        }
                        value={inventoryForm.productSkuId}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="material-quantity">Material quantity</Label>
                      <Input
                        id="material-quantity"
                        inputMode="numeric"
                        onChange={(event) =>
                          setInventoryForm((current) => ({
                            ...current,
                            quantity: event.target.value,
                          }))
                        }
                        value={inventoryForm.quantity}
                      />
                    </div>
                    <Button
                      onClick={() =>
                        onRecordInventoryUsage({
                          productSkuId: inventoryForm.productSkuId,
                          quantity: Number(inventoryForm.quantity),
                          serviceCaseId: activeServiceCaseId,
                          usageType: "consumed",
                        })
                      }
                      type="button"
                      variant="outline"
                    >
                      Record material usage
                    </Button>
                  </section>
                </div>
              </>
            )}
          </div>
        </section>
      </FadeIn>
    </View>
  );
}

export function ServiceCasesView() {
  const { activeStore } = useGetActiveStore();
  const { canAccessOperations, isLoading } = usePermissions();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const serviceCases = useQuery(
    api.serviceOps.serviceCases.listActiveServiceCases,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  ) as ServiceCaseListItem[] | undefined;

  const selectedCaseDetails = useQuery(
    api.serviceOps.serviceCases.getServiceCaseDetails,
    selectedCaseId ? { serviceCaseId: selectedCaseId as any } : "skip"
  ) as ServiceCaseDetails | null | undefined;

  const customerResults = useQuery(
    api.operations.serviceIntake.searchCustomers,
    activeStore?._id && deferredSearchQuery.trim()
      ? { searchQuery: deferredSearchQuery, storeId: activeStore._id }
      : "skip"
  ) as CustomerResult[] | undefined;

  const staffOptions = useQuery(
    api.operations.serviceIntake.listAssignableStaff,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  ) as StaffOption[] | undefined;

  const catalogItems = useQuery(
    api.serviceOps.catalog.listServiceCatalogItems,
    activeStore?._id ? { status: "active", storeId: activeStore._id } : "skip"
  ) as CatalogItem[] | undefined;

  const createWalkInServiceCase = useMutation(
    api.serviceOps.serviceCases.createWalkInServiceCase
  );
  const addServiceCaseLineItem = useMutation(
    api.serviceOps.serviceCases.addServiceCaseLineItem
  );
  const recordServiceInventoryUsage = useMutation(
    api.serviceOps.serviceCases.recordServiceInventoryUsage
  );
  const recordServicePayment = useMutation(
    api.serviceOps.serviceCases.recordServicePayment
  );
  const updateServiceCaseStatus = useMutation(
    api.serviceOps.serviceCases.updateServiceCaseStatus
  );

  const withSaveState = async (action: () => Promise<void>) => {
    setIsSaving(true);
    try {
      await action();
    } finally {
      setIsSaving(false);
    }
  };

  if (!activeStore) {
    return (
      <View>
        <div className="container mx-auto py-8">
          <EmptyState
            description="Select a store before opening service cases."
            title="No active store"
          />
        </div>
      </View>
    );
  }

  const resolvedSelectedCaseId =
    selectedCaseId ?? serviceCases?.[0]?._id ?? null;

  return (
    <ServiceCasesViewContent
      catalogItems={catalogItems ?? []}
      customerResults={customerResults ?? []}
      hasFullAdminAccess={canAccessOperations()}
      isLoadingPermissions={isLoading}
      isSaving={isSaving}
      onAddLineItem={(args) =>
        withSaveState(async () => {
          await addServiceCaseLineItem({
            ...args,
            serviceCaseId: args.serviceCaseId as any,
          });
          toast.success("Line item added");
        })
      }
      onCreateCase={(args) =>
        withSaveState(async () => {
          const createdCase = await createWalkInServiceCase({
            ...args,
            assignedStaffProfileId: args.assignedStaffProfileId as any,
            customerProfileId: args.customerProfileId as any,
            serviceCatalogId: args.serviceCatalogId
              ? (args.serviceCatalogId as any)
              : undefined,
            storeId: activeStore._id,
          });
          setSelectedCaseId((createdCase as any)?._id ?? null);
          toast.success("Service case created");
        })
      }
      onRecordInventoryUsage={(args) =>
        withSaveState(async () => {
          await recordServiceInventoryUsage({
            ...args,
            productSkuId: args.productSkuId as any,
            serviceCaseId: args.serviceCaseId as any,
          });
          toast.success("Material usage recorded");
        })
      }
      onRecordPayment={(args) =>
        withSaveState(async () => {
          await recordServicePayment({
            ...args,
            serviceCaseId: args.serviceCaseId as any,
          });
          toast.success("Payment recorded");
        })
      }
      onUpdateStatus={(args) =>
        withSaveState(async () => {
          await updateServiceCaseStatus({
            ...args,
            serviceCaseId: args.serviceCaseId as any,
            status: args.status as any,
          });
          toast.success("Service case updated");
        })
      }
      searchQuery={searchQuery}
      selectedCaseDetails={selectedCaseDetails ?? null}
      selectedCaseId={resolvedSelectedCaseId}
      serviceCases={serviceCases ?? []}
      setSearchQuery={setSearchQuery}
      setSelectedCaseId={setSelectedCaseId}
      staffOptions={staffOptions ?? []}
    />
  );
}
