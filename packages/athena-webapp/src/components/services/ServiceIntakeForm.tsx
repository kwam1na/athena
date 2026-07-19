import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "../ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Textarea } from "../ui/textarea";
import { cn } from "@/lib/utils";
import {
  formatServiceCatalogName,
  serviceModeLabels,
  type ServiceCatalogItem,
} from "./serviceCatalogForm";

export type ServiceIntakeCustomerResult = {
  _id: string;
  email?: string;
  fullName: string;
  phoneNumber?: string;
};

export type ServiceIntakeStaffOption = {
  _id: string;
  fullName: string;
  phoneNumber?: string;
  roles: string[];
};

export type ServiceIntakeCatalogOption = Pick<
  ServiceCatalogItem,
  "_id" | "durationMinutes" | "name" | "serviceMode"
>;

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
  catalogOptions: ServiceIntakeCatalogOption[];
  customerResults: ServiceIntakeCustomerResult[];
  form: ServiceIntakeFormState;
  isActionDisabled?: boolean;
  isSubmitting: boolean;
  onChange: <K extends keyof ServiceIntakeFormState>(
    field: K,
    value: ServiceIntakeFormState[K],
  ) => void;
  onSelectCustomer: (customer: ServiceIntakeCustomerResult) => void;
  onSubmit: () => void;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  staffOptions: ServiceIntakeStaffOption[];
  validationErrors: string[];
};

function ServiceCatalogSelect({
  catalogOptions,
  onChange,
  value,
}: {
  catalogOptions: ServiceIntakeCatalogOption[];
  onChange: (value: string) => void;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedCatalogItem = catalogOptions.find(
    (item) => item.name === value,
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          aria-expanded={open}
          aria-label="Service title"
          className="h-10 w-full justify-between px-3 py-2 text-left font-normal"
          id="service-title"
          role="combobox"
          type="button"
          variant="outline"
        >
          <span
            className={cn(
              "truncate",
              selectedCatalogItem ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {selectedCatalogItem
              ? formatServiceCatalogName(selectedCatalogItem.name)
              : "Select service"}
          </span>
          <ChevronsUpDown
            aria-hidden="true"
            className="ml-2 h-4 w-4 shrink-0 opacity-50"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-0">
        <Command>
          <CommandInput placeholder="Search services..." />
          <CommandList>
            <CommandEmpty>No service found</CommandEmpty>
            <CommandGroup heading="Services">
              {catalogOptions.map((item) => (
                <CommandItem
                  key={item._id}
                  onSelect={() => {
                    onChange(item.name);
                    setOpen(false);
                  }}
                  value={[
                    item.name,
                    serviceModeLabels[item.serviceMode],
                    `${item.durationMinutes} minutes`,
                  ].join(" ")}
                >
                  <Check
                    aria-hidden="true"
                    className={cn(
                      "mr-2 h-4 w-4",
                      selectedCatalogItem?._id === item._id
                        ? "opacity-100"
                        : "opacity-0",
                    )}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">
                      {formatServiceCatalogName(item.name)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {`${item.durationMinutes} min · ${serviceModeLabels[item.serviceMode]}`}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function ServiceIntakeForm({
  catalogOptions,
  customerResults,
  form,
  isActionDisabled = false,
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
    <div className="space-y-layout-xl">
      {validationErrors.length > 0 ? (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-layout-md py-layout-sm text-sm text-danger">
          <p className="font-medium">Fix the highlighted intake details</p>
          <ul className="mt-2 list-disc pl-5">
            {validationErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-layout-xl lg:grid-cols-2">
        <section className="space-y-layout-lg rounded-lg border border-border bg-surface p-layout-lg shadow-surface">
          <div className="space-y-1.5 border-b border-border/70 pb-layout-sm">
            <h3 className="text-xl font-semibold tracking-tight text-foreground">
              Customer
            </h3>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
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
            <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
              {customerResults.map((customer) => (
                <button
                  className="flex w-full items-start justify-between rounded-md border border-border bg-background px-3 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

          <div className="grid gap-layout-md sm:grid-cols-2">
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
                onChange={(event) =>
                  onChange("customerEmail", event.target.value)
                }
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
                required
                value={form.customerPhoneNumber}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="customer-notes">Customer notes</Label>
              <Textarea
                id="customer-notes"
                onChange={(event) =>
                  onChange("customerNotes", event.target.value)
                }
                placeholder="Hairline concerns, preferred stylist, prior repairs..."
                value={form.customerNotes}
              />
            </div>
          </div>
        </section>

        <section className="space-y-layout-lg rounded-lg border border-border bg-surface p-layout-lg shadow-surface">
          <div className="space-y-1.5 border-b border-border/70 pb-layout-sm">
            <h3 className="text-xl font-semibold tracking-tight text-foreground">
              Intake
            </h3>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Capture the work, assignee, and optional deposit without a full
              calendar.
            </p>
          </div>

          <div className="grid gap-layout-md sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="service-title">Service title</Label>
              <ServiceCatalogSelect
                catalogOptions={catalogOptions}
                onChange={(value) => onChange("serviceTitle", value)}
                value={form.serviceTitle}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="assigned-staff">Assigned staff</Label>
              <Select
                onValueChange={(value) =>
                  onChange("assignedStaffProfileId", value)
                }
                value={form.assignedStaffProfileId}
              >
                <SelectTrigger aria-label="Assigned staff" id="assigned-staff">
                  <SelectValue placeholder="Select staff member" />
                </SelectTrigger>
                <SelectContent>
                  {staffOptions.map((staff) => (
                    <SelectItem key={staff._id} value={staff._id}>
                      {staff.fullName}
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
                    value as ServiceIntakeFormState["intakeChannel"],
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
                  onChange(
                    "priority",
                    value as ServiceIntakeFormState["priority"],
                  )
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
                onChange={(event) =>
                  onChange("depositAmount", event.target.value)
                }
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
        <Button
          disabled={isActionDisabled || isSubmitting}
          onClick={onSubmit}
          type="button"
          variant="default"
        >
          {isSubmitting ? "Creating intake..." : "Create intake"}
        </Button>
      </div>
    </div>
  );
}
