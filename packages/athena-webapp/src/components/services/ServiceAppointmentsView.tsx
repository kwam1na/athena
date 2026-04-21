import { useDeferredValue, useState } from "react";
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

type AppointmentItem = {
  _id: string;
  assignedStaffName?: string | null;
  customerName?: string | null;
  endAt: number;
  serviceCatalogName?: string | null;
  startAt: number;
  status: string;
};

type CreateAppointmentArgs = {
  assignedStaffProfileId: string;
  customerProfileId: string;
  notes?: string;
  serviceCatalogId: string;
  startAt: number;
};

type ServiceAppointmentsViewContentProps = {
  appointments: AppointmentItem[];
  catalogItems: CatalogItem[];
  customerResults: CustomerResult[];
  hasFullAdminAccess: boolean;
  isLoadingPermissions: boolean;
  isSaving: boolean;
  onCancelAppointment: (args: { appointmentId: string }) => Promise<void>;
  onConvertAppointment: (args: { appointmentId: string }) => Promise<void>;
  onCreateAppointment: (args: CreateAppointmentArgs) => Promise<void>;
  onRescheduleAppointment: (args: {
    appointmentId: string;
    startAt: number;
  }) => Promise<void>;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  staffOptions: StaffOption[];
};

const initialFormState = {
  assignedStaffProfileId: "",
  notes: "",
  selectedCustomerId: "",
  serviceCatalogId: "",
  startAt: "",
};

function parseDateTimeLocal(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

export function ServiceAppointmentsViewContent({
  appointments,
  catalogItems,
  customerResults,
  hasFullAdminAccess,
  isLoadingPermissions,
  isSaving,
  onCancelAppointment,
  onConvertAppointment,
  onCreateAppointment,
  onRescheduleAppointment,
  searchQuery,
  setSearchQuery,
  staffOptions,
}: ServiceAppointmentsViewContentProps) {
  const [form, setForm] = useState(initialFormState);
  const [rescheduleTimes, setRescheduleTimes] = useState<Record<string, string>>({});
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  if (isLoadingPermissions) {
    return (
      <View>
        <div className="container mx-auto py-10 text-sm text-muted-foreground">
          Loading appointments...
        </div>
      </View>
    );
  }

  if (!hasFullAdminAccess) {
    return <NoPermissionView />;
  }

  const handleSubmit = async () => {
    const errors: string[] = [];

    if (!form.selectedCustomerId) {
      errors.push("Select a customer.");
    }

    if (!form.serviceCatalogId) {
      errors.push("Select a catalog item.");
    }

    if (!form.assignedStaffProfileId) {
      errors.push("Select a staff member.");
    }

    const parsedStartAt = parseDateTimeLocal(form.startAt);
    if (!form.startAt || parsedStartAt === null) {
      errors.push("Choose an appointment start time.");
    }

    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    try {
      await onCreateAppointment({
        assignedStaffProfileId: form.assignedStaffProfileId,
        customerProfileId: form.selectedCustomerId,
        notes: form.notes.trim() || undefined,
        serviceCatalogId: form.serviceCatalogId,
        startAt: parsedStartAt!,
      });
      setForm(initialFormState);
      setValidationErrors([]);
      setSearchQuery("");
    } catch (error) {
      toast.error("Failed to schedule appointment", {
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
          <p className="text-xl font-medium">Service appointments</p>
        </div>
      }
    >
      <FadeIn className="container mx-auto grid gap-6 py-8 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <section className="space-y-4 rounded-lg border p-4">
          <div>
            <h3 className="text-base font-medium">Schedule appointment</h3>
            <p className="text-sm text-muted-foreground">
              Create, reschedule, and convert appointments into live service work.
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
            <Label htmlFor="appointment-search">Search existing customers</Label>
            <Input
              id="appointment-search"
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
                    setForm((current) => ({
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
            <Label htmlFor="service-catalog">Service catalog</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              id="service-catalog"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  serviceCatalogId: event.target.value,
                }))
              }
              value={form.serviceCatalogId}
            >
              <option value="">Select service</option>
              {catalogItems.map((item) => (
                <option key={item._id} value={item._id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="assigned-staff">Assigned staff</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              id="assigned-staff"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  assignedStaffProfileId: event.target.value,
                }))
              }
              value={form.assignedStaffProfileId}
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
            <Label htmlFor="appointment-start">Appointment start</Label>
            <Input
              id="appointment-start"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  startAt: event.target.value,
                }))
              }
              type="datetime-local"
              value={form.startAt}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="appointment-notes">Notes</Label>
            <Input
              id="appointment-notes"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
              value={form.notes}
            />
          </div>

          <Button disabled={isSaving} onClick={handleSubmit} type="button">
            Schedule appointment
          </Button>
        </section>

        <section className="space-y-3 rounded-lg border p-4">
          <div>
            <h3 className="text-base font-medium">Scheduled work</h3>
            <p className="text-sm text-muted-foreground">
              Manage active appointments and convert them into live service cases.
            </p>
          </div>

          {appointments.length === 0 ? (
            <EmptyState
              description="Booked appointments will appear here."
              title="No active appointments"
            />
          ) : (
            appointments.map((appointment) => (
              <article className="space-y-3 rounded-md border p-3" key={appointment._id}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium">
                      {appointment.serviceCatalogName ?? "Service appointment"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {[appointment.customerName, appointment.assignedStaffName]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <span className="text-xs uppercase text-muted-foreground">
                    {appointment.status}
                  </span>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`reschedule-${appointment._id}`}>
                    {`New time for ${appointment.serviceCatalogName ?? "appointment"}`}
                  </Label>
                  <Input
                    id={`reschedule-${appointment._id}`}
                    onChange={(event) =>
                      setRescheduleTimes((current) => ({
                        ...current,
                        [appointment._id]: event.target.value,
                      }))
                    }
                    type="datetime-local"
                    value={rescheduleTimes[appointment._id] ?? ""}
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    aria-label={`Reschedule ${appointment.serviceCatalogName ?? "appointment"}`}
                    onClick={() => {
                      const parsedStartAt = parseDateTimeLocal(
                        rescheduleTimes[appointment._id] ?? ""
                      );

                      if (parsedStartAt === null) {
                        toast.error("Choose a new start time before rescheduling.");
                        return;
                      }

                      onRescheduleAppointment({
                        appointmentId: appointment._id,
                        startAt: parsedStartAt,
                      });
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Reschedule
                  </Button>
                  <Button
                    aria-label={`Cancel ${appointment.serviceCatalogName ?? "appointment"}`}
                    onClick={() =>
                      onCancelAppointment({
                        appointmentId: appointment._id,
                      })
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Cancel
                  </Button>
                  <Button
                    aria-label={`Convert ${appointment.serviceCatalogName ?? "appointment"}`}
                    onClick={() =>
                      onConvertAppointment({
                        appointmentId: appointment._id,
                      })
                    }
                    size="sm"
                    type="button"
                  >
                    Convert to walk-in
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

export function ServiceAppointmentsView() {
  const { activeStore } = useGetActiveStore();
  const { canAccessOperations, isLoading } = usePermissions();
  const [searchQuery, setSearchQuery] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const appointments = useQuery(
    api.serviceOps.appointments.listAppointments,
    activeStore?._id ? { storeId: activeStore._id } : "skip"
  ) as AppointmentItem[] | undefined;

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

  const createAppointment = useMutation(api.serviceOps.appointments.createAppointment);
  const rescheduleAppointment = useMutation(
    api.serviceOps.appointments.rescheduleAppointment
  );
  const cancelAppointment = useMutation(api.serviceOps.appointments.cancelAppointment);
  const convertAppointmentToWalkIn = useMutation(
    api.serviceOps.appointments.convertAppointmentToWalkIn
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
            description="Select a store before opening service appointments."
            title="No active store"
          />
        </div>
      </View>
    );
  }

  return (
    <ServiceAppointmentsViewContent
      appointments={appointments ?? []}
      catalogItems={catalogItems ?? []}
      customerResults={customerResults ?? []}
      hasFullAdminAccess={canAccessOperations()}
      isLoadingPermissions={isLoading}
      isSaving={isSaving}
      onCancelAppointment={(args) =>
        withSaveState(async () => {
          await cancelAppointment({
            appointmentId: args.appointmentId as any,
          });
          toast.success("Appointment cancelled");
        })
      }
      onConvertAppointment={(args) =>
        withSaveState(async () => {
          await convertAppointmentToWalkIn({
            appointmentId: args.appointmentId as any,
          });
          toast.success("Appointment converted to walk-in");
        })
      }
      onCreateAppointment={(args) =>
        withSaveState(async () => {
          await createAppointment({
            ...args,
            assignedStaffProfileId: args.assignedStaffProfileId as any,
            customerProfileId: args.customerProfileId as any,
            serviceCatalogId: args.serviceCatalogId as any,
            storeId: activeStore._id,
          });
          toast.success("Appointment scheduled");
        })
      }
      onRescheduleAppointment={(args) =>
        withSaveState(async () => {
          await rescheduleAppointment({
            appointmentId: args.appointmentId as any,
            startAt: args.startAt,
          });
          toast.success("Appointment rescheduled");
        })
      }
      searchQuery={searchQuery}
      setSearchQuery={setSearchQuery}
      staffOptions={staffOptions ?? []}
    />
  );
}
