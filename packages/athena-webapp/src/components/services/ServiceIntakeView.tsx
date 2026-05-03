import { useDeferredValue, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import View from "../View";
import { FadeIn } from "../common/FadeIn";
import { EmptyState } from "../states/empty/empty-state";
import { NoPermissionView } from "../states/no-permission/NoPermissionView";
import { ProtectedAdminSignInView } from "../states/signed-out/ProtectedAdminSignInView";
import { useAuth } from "@/hooks/useAuth";
import { useProtectedAdminPageState } from "@/hooks/useProtectedAdminPageState";
import { type NormalizedCommandResult, runCommand } from "@/lib/errors/runCommand";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import { parseDisplayAmountInput } from "~/src/lib/pos/displayAmounts";
import {
  ServiceIntakeCustomerResult,
  ServiceIntakeForm,
  ServiceIntakeFormState,
  ServiceIntakeStaffOption,
} from "./ServiceIntakeForm";
import { validateServiceIntakeInput } from "~/shared/serviceIntake";

const operationsApi = api.operations;

const initialFormState: ServiceIntakeFormState = {
  assignedStaffProfileId: "",
  customerEmail: "",
  customerFullName: "",
  customerNotes: "",
  customerPhoneNumber: "",
  depositAmount: "",
  depositMethod: "",
  intakeChannel: "walk_in",
  itemDescription: "",
  notes: "",
  priority: "normal",
  serviceTitle: "",
};

type ServiceIntakeViewContentProps = {
  customerResults: ServiceIntakeCustomerResult[];
  hasFullAdminAccess: boolean;
  isLoadingPermissions: boolean;
  isSubmitting: boolean;
  onCreateIntake: (
    args: CreateServiceIntakeArgs
  ) => Promise<NormalizedCommandResult<CreateServiceIntakeResult>>;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  staffOptions: ServiceIntakeStaffOption[] | undefined;
  storeId?: Id<"store">;
  userId?: Id<"athenaUser">;
};

type CreateServiceIntakeArgs = {
  assignedStaffProfileId: Id<"staffProfile">;
  createdByUserId?: Id<"athenaUser">;
  customerEmail?: string;
  customerFullName?: string;
  customerNotes?: string;
  customerPhoneNumber?: string;
  customerProfileId?: Id<"customerProfile">;
  depositAmount?: number;
  depositMethod?: "cash" | "card" | "mobile_money";
  intakeChannel: "walk_in" | "phone_booking";
  itemDescription?: string;
  notes?: string;
  priority: "normal" | "high" | "urgent";
  serviceTitle: string;
  storeId: Id<"store">;
};

type CreateServiceIntakeResult = {
  approvalRequestId?: Id<"approvalRequest">;
  customerProfileId: Id<"customerProfile">;
  serviceCaseId: Id<"serviceCase">;
  workItemId: Id<"operationalWorkItem">;
};

export function ServiceIntakeViewContent({
  customerResults,
  hasFullAdminAccess,
  isLoadingPermissions,
  isSubmitting,
  onCreateIntake,
  searchQuery,
  setSearchQuery,
  staffOptions,
  storeId,
  userId,
}: ServiceIntakeViewContentProps) {
  const [form, setForm] = useState<ServiceIntakeFormState>(initialFormState);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  if (isLoadingPermissions) {
    return (
      <View>
        <div className="container mx-auto py-10 text-sm text-muted-foreground">
          Loading service intake...
        </div>
      </View>
    );
  }

  if (!hasFullAdminAccess) {
    return <NoPermissionView />;
  }

  if (!staffOptions) {
    return (
      <View>
        <div className="container mx-auto py-10 text-sm text-muted-foreground">
          Loading service intake...
        </div>
      </View>
    );
  }

  const handleChange = <K extends keyof ServiceIntakeFormState>(
    field: K,
    value: ServiceIntakeFormState[K]
  ) => {
    setForm((current) => ({
      ...current,
      [field]: value,
      ...(field === "depositAmount" && value === ""
        ? { depositMethod: "" }
        : null),
    }));
  };

  const handleSelectCustomer = (customer: ServiceIntakeCustomerResult) => {
    setForm((current) => ({
      ...current,
      customerEmail: customer.email ?? current.customerEmail,
      customerFullName: customer.fullName,
      customerPhoneNumber: customer.phoneNumber ?? current.customerPhoneNumber,
      selectedCustomerId: customer._id,
    }));
    setValidationErrors([]);
  };

  const handleSubmit = async () => {
    const parsedDepositAmount = form.depositAmount.trim()
      ? parseDisplayAmountInput(form.depositAmount)
      : undefined;
    const hasInvalidDepositAmount =
      form.depositAmount.trim() && parsedDepositAmount === undefined;
    const errors = validateServiceIntakeInput({
      assignedStaffProfileId: form.assignedStaffProfileId,
      customerFullName: form.customerFullName,
      customerProfileId: form.selectedCustomerId,
      depositAmount: hasInvalidDepositAmount ? 0 : parsedDepositAmount,
      depositMethod: form.depositMethod || undefined,
      serviceTitle: form.serviceTitle,
    });

    if (errors.length > 0 || !storeId) {
      setValidationErrors(storeId ? errors : ["An active store is required"]);
      return;
    }

    setValidationErrors([]);

    const result = await onCreateIntake({
      assignedStaffProfileId: form.assignedStaffProfileId as Id<"staffProfile">,
      createdByUserId: userId,
      customerEmail: form.customerEmail || undefined,
      customerFullName: form.customerFullName || undefined,
      customerNotes: form.customerNotes || undefined,
      customerPhoneNumber: form.customerPhoneNumber || undefined,
      customerProfileId:
        (form.selectedCustomerId as Id<"customerProfile"> | undefined) ??
        undefined,
      depositAmount: parsedDepositAmount,
      depositMethod:
        (form.depositMethod as "cash" | "card" | "mobile_money") || undefined,
      intakeChannel: form.intakeChannel,
      itemDescription: form.itemDescription || undefined,
      notes: form.notes || undefined,
      priority: form.priority,
      serviceTitle: form.serviceTitle.trim(),
      storeId,
    });

    if (result.kind !== "ok") {
      setValidationErrors([result.error.message]);
      return;
    }

    setForm(initialFormState);
    setSearchQuery("");
    setValidationErrors([]);
    toast.success("Service intake created");
  };

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      header={
        <div className="container mx-auto flex h-[40px] items-center">
          <p className="text-xl font-medium">Service intake</p>
        </div>
      }
    >
      <FadeIn className="container mx-auto py-8">
        <ServiceIntakeForm
          customerResults={customerResults}
          form={form}
          isSubmitting={isSubmitting}
          onChange={handleChange}
          onSelectCustomer={handleSelectCustomer}
          onSubmit={handleSubmit}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          staffOptions={staffOptions}
          validationErrors={validationErrors}
        />
      </FadeIn>
    </View>
  );
}

export function ServiceIntakeView() {
  const {
    activeStore,
    canQueryProtectedData,
    hasFullAdminAccess,
    isAuthenticated,
    isLoadingAccess,
  } = useProtectedAdminPageState();
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const customerResults = useQuery(
    operationsApi.serviceIntake.searchCustomers,
    canQueryProtectedData && deferredSearchQuery.trim()
      ? { searchQuery: deferredSearchQuery, storeId: activeStore!._id }
      : "skip"
  ) as ServiceIntakeCustomerResult[] | undefined;

  const staffOptions = useQuery(
    operationsApi.serviceIntake.listAssignableStaff,
    canQueryProtectedData ? { storeId: activeStore!._id } : "skip"
  ) as ServiceIntakeStaffOption[] | undefined;

  const createServiceIntake = useMutation(
    operationsApi.serviceIntake.createServiceIntake
  );

  const handleCreateIntake = async (args: CreateServiceIntakeArgs) => {
    setIsSubmitting(true);
    try {
      return await runCommand(() => createServiceIntake(args));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoadingAccess) {
    return (
      <View>
        <div className="container mx-auto py-10 text-sm text-muted-foreground">
          Loading service intake...
        </div>
      </View>
    );
  }

  if (!isAuthenticated) {
    return (
      <ProtectedAdminSignInView description="Your Athena session needs to reconnect before service intake can load protected operations data" />
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
            description="Select a store before opening the proving-path service intake"
            title="No active store"
          />
        </div>
      </View>
    );
  }

  return (
    <ServiceIntakeViewContent
      customerResults={customerResults ?? []}
      hasFullAdminAccess={hasFullAdminAccess}
      isLoadingPermissions={false}
      isSubmitting={isSubmitting}
      onCreateIntake={handleCreateIntake}
      searchQuery={searchQuery}
      setSearchQuery={setSearchQuery}
      staffOptions={staffOptions}
      storeId={activeStore._id}
      userId={user?._id}
    />
  );
}
