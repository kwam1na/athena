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

export type ServiceIntakeCustomerResult = {
  _id: string;
  email?: string;
  fullName: string;
  phoneNumber?: string;
};

export type ServiceIntakeStaffOption = {
  _id: string;
  email?: string;
  fullName: string;
  roles: string[];
};

export type ServiceIntakeFormState = {
  assignedStaffProfileId: string;
  customerEmail: string;
  customerFullName: string;
  customerNotes: string;
  customerPhoneNumber: string;
  depositAmount: string;
  depositMethod: string;
  intakeChannel: "walk_in" | "phone_booking";
  itemDescription: string;
  notes: string;
  priority: "normal" | "high" | "urgent";
  selectedCustomerId?: string;
  serviceTitle: string;
};

type ServiceIntakeFormProps = {
  customerResults: ServiceIntakeCustomerResult[];
  form: ServiceIntakeFormState;
  isSubmitting: boolean;
  onChange: <K extends keyof ServiceIntakeFormState>(
    field: K,
    value: ServiceIntakeFormState[K]
  ) => void;
  onSelectCustomer: (customer: ServiceIntakeCustomerResult) => void;
  onSubmit: () => void;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  staffOptions: ServiceIntakeStaffOption[];
  validationErrors: string[];
};

export function ServiceIntakeForm({
  customerResults,
  form,
  isSubmitting,
  onChange,
  onSelectCustomer,
  onSubmit,
  searchQuery,
  setSearchQuery,
  staffOptions,
  validationErrors,
}: ServiceIntakeFormProps) {
  return (
    <div className="space-y-6">
      {validationErrors.length > 0 ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-medium">Fix the highlighted intake details.</p>
          <ul className="mt-2 list-disc pl-5">
            {validationErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-4 rounded-lg border p-4">
          <div>
            <h3 className="text-base font-medium">Customer</h3>
            <p className="text-sm text-muted-foreground">
              Link an existing customer or capture the walk-in details directly.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="customer-search">Search existing customers</Label>
            <Input
              id="customer-search"
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search by name, email, or phone"
              value={searchQuery}
            />
          </div>

          {customerResults.length > 0 ? (
            <div className="space-y-2 rounded-md border bg-muted/20 p-3">
              {customerResults.map((customer) => (
                <button
                  className="flex w-full items-start justify-between rounded-md border bg-background px-3 py-2 text-left"
                  key={customer._id}
                  onClick={() => onSelectCustomer(customer)}
                  type="button"
                >
                  <div>
                    <p className="font-medium">{customer.fullName}</p>
                    <p className="text-xs text-muted-foreground">
                      {[customer.email, customer.phoneNumber]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    Use customer
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="customer-full-name">Customer name</Label>
              <Input
                id="customer-full-name"
                onChange={(event) =>
                  onChange("customerFullName", event.target.value)
                }
                placeholder="Ama Mensah"
                value={form.customerFullName}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customer-email">Email</Label>
              <Input
                id="customer-email"
                onChange={(event) => onChange("customerEmail", event.target.value)}
                placeholder="ama@example.com"
                value={form.customerEmail}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customer-phone">Phone number</Label>
              <Input
                id="customer-phone"
                onChange={(event) =>
                  onChange("customerPhoneNumber", event.target.value)
                }
                placeholder="+233 20 000 0000"
                value={form.customerPhoneNumber}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="customer-notes">Customer notes</Label>
              <Textarea
                id="customer-notes"
                onChange={(event) => onChange("customerNotes", event.target.value)}
                placeholder="Hairline concerns, preferred stylist, prior repairs..."
                value={form.customerNotes}
              />
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-lg border p-4">
          <div>
            <h3 className="text-base font-medium">Intake</h3>
            <p className="text-sm text-muted-foreground">
              Capture the work, assignee, and optional deposit without a full calendar.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="service-title">Service title</Label>
              <Input
                id="service-title"
                onChange={(event) => onChange("serviceTitle", event.target.value)}
                placeholder="Wash and restyle closure wig"
                value={form.serviceTitle}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="assigned-staff">Assigned staff</Label>
              <Select
                onValueChange={(value) => onChange("assignedStaffProfileId", value)}
                value={form.assignedStaffProfileId}
              >
                <SelectTrigger aria-label="Assigned staff" id="assigned-staff">
                  <SelectValue placeholder="Select staff member" />
                </SelectTrigger>
                <SelectContent>
                  {staffOptions.map((staff) => (
                    <SelectItem key={staff._id} value={staff._id}>
                      {staff.fullName}
                      {staff.roles.length > 0 ? ` · ${staff.roles.join(", ")}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="intake-channel">Channel</Label>
              <Select
                onValueChange={(value) =>
                  onChange(
                    "intakeChannel",
                    value as ServiceIntakeFormState["intakeChannel"]
                  )
                }
                value={form.intakeChannel}
              >
                <SelectTrigger aria-label="Channel" id="intake-channel">
                  <SelectValue placeholder="Select channel" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="walk_in">Walk-in</SelectItem>
                  <SelectItem value="phone_booking">Phone booking</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="priority">Priority</Label>
              <Select
                onValueChange={(value) =>
                  onChange("priority", value as ServiceIntakeFormState["priority"])
                }
                value={form.priority}
              >
                <SelectTrigger aria-label="Priority" id="priority">
                  <SelectValue placeholder="Select priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="deposit-amount">Deposit amount</Label>
              <Input
                id="deposit-amount"
                inputMode="numeric"
                onChange={(event) => onChange("depositAmount", event.target.value)}
                placeholder="Optional"
                value={form.depositAmount}
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="deposit-method">Deposit method</Label>
              <Select
                onValueChange={(value) => onChange("depositMethod", value)}
                value={form.depositMethod}
              >
                <SelectTrigger aria-label="Deposit method" id="deposit-method">
                  <SelectValue placeholder="No deposit collected" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="mobile_money">Mobile money</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="item-description">Item description</Label>
              <Textarea
                id="item-description"
                onChange={(event) =>
                  onChange("itemDescription", event.target.value)
                }
                placeholder="Describe the wig, closure, bundles, or service item being checked in."
                value={form.itemDescription}
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="intake-notes">Intake notes</Label>
              <Textarea
                id="intake-notes"
                onChange={(event) => onChange("notes", event.target.value)}
                placeholder="Timeline promises, styling requests, condition notes..."
                value={form.notes}
              />
            </div>
          </div>
        </section>
      </div>

      <div className="flex justify-end">
        <Button disabled={isSubmitting} onClick={onSubmit} type="button">
          {isSubmitting ? "Creating intake..." : "Create intake"}
        </Button>
      </div>
    </div>
  );
}
