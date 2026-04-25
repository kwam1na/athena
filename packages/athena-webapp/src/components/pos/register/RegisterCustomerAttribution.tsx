import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CustomerInfo } from "@/components/pos/types";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import {
  useConvexPosCustomerCreate,
  useConvexPosCustomerSearch,
} from "@/lib/pos/infrastructure/convex/customerGateway";
import { cn } from "~/src/lib/utils";
import type { POSCustomerSummary } from "~/types";
import { Plus, Search, UserRound, X } from "lucide-react";
import { useMemo, useState } from "react";

interface RegisterCustomerAttributionProps {
  customerInfo: CustomerInfo;
  onCustomerCommitted: (customer: CustomerInfo) => Promise<void>;
  setCustomerInfo: (
    customer:
      | CustomerInfo
      | ((currentCustomer: CustomerInfo) => CustomerInfo),
  ) => void;
}

const EMPTY_CUSTOMER_INFO: CustomerInfo = {
  customerId: undefined,
  customerProfileId: undefined,
  name: "",
  email: "",
  phone: "",
};

function trimCustomerInfo(customer: CustomerInfo): CustomerInfo {
  return {
    customerId: customer.customerId,
    customerProfileId: customer.customerProfileId,
    name: customer.name.trim(),
    email: customer.email.trim(),
    phone: customer.phone.trim(),
  };
}

function getSecondaryIdentifier(customer: CustomerInfo) {
  return customer.email.trim() || customer.phone.trim();
}

function toCustomerInfo(customer: POSCustomerSummary): CustomerInfo {
  return {
    customerId: customer._id,
    customerProfileId: customer.customerProfileId,
    name: customer.name,
    email: customer.email || "",
    phone: customer.phone || "",
  };
}

export function RegisterCustomerAttribution({
  customerInfo,
  onCustomerCommitted,
  setCustomerInfo,
}: RegisterCustomerAttributionProps) {
  const { activeStore } = useGetActiveStore();
  const [isExpanded, setIsExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isAddingCustomer, setIsAddingCustomer] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const normalizedCustomer = useMemo(
    () => trimCustomerInfo(customerInfo),
    [customerInfo],
  );
  const hasCustomer =
    normalizedCustomer.customerId ||
    normalizedCustomer.name ||
    normalizedCustomer.email ||
    normalizedCustomer.phone;
  const secondaryIdentifier = getSecondaryIdentifier(normalizedCustomer);
  const trimmedSearchQuery = searchQuery.trim();
  const searchResults =
    useConvexPosCustomerSearch(activeStore?._id, searchQuery) ?? [];
  const createCustomer = useConvexPosCustomerCreate();

  const commitCustomer = (customer: CustomerInfo) => {
    setCustomerInfo(customer);
    void onCustomerCommitted(customer);
  };

  const handleSelectCustomer = (customer: POSCustomerSummary) => {
    commitCustomer(toCustomerInfo(customer));
    setInlineError(null);
    setSearchQuery("");
    setIsExpanded(false);
  };

  const handleClearCustomer = () => {
    commitCustomer(EMPTY_CUSTOMER_INFO);
    setInlineError(null);
    setSearchQuery("");
    setIsExpanded(false);
  };

  const handleAddFromSearch = async () => {
    if (!activeStore || !trimmedSearchQuery || isAddingCustomer) {
      return;
    }

    setIsAddingCustomer(true);
    setInlineError(null);

    const result = await createCustomer({
      storeId: activeStore._id,
      name: trimmedSearchQuery,
    });

    setIsAddingCustomer(false);

    if (result.kind !== "ok") {
      setInlineError("Customer was not added. Try again.");
      return;
    }

    const nextCustomer = {
      customerId: result.data._id,
      customerProfileId: result.data.customerProfileId,
      name: result.data.name,
      email: result.data.email || "",
      phone: result.data.phone || "",
    };
    commitCustomer(nextCustomer);
    setSearchQuery("");
    setIsExpanded(false);
  };

  return (
    <section
      aria-label="Customer attribution"
      className="rounded-lg border border-border/80 bg-muted/20 px-4 py-3"
    >
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border bg-white",
              hasCustomer
                ? "border-emerald-200 text-emerald-700"
                : "border-border text-muted-foreground",
            )}
          >
            <UserRound className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-gray-950">
              {hasCustomer
                ? normalizedCustomer.name || "Customer"
                : "Walk-in customer"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {hasCustomer
                ? secondaryIdentifier || "Customer selected"
                : "No customer assigned"}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {hasCustomer ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 px-3 text-xs"
                onClick={() => setIsExpanded(true)}
              >
                Change
                <span className="sr-only"> customer</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-3 text-xs text-muted-foreground hover:text-gray-950"
                onClick={handleClearCustomer}
              >
                Clear
                <span className="sr-only"> customer</span>
              </Button>
            </>
          ) : (
            <Button
              type="button"
              size="sm"
              className="h-8 px-3 text-xs"
              onClick={() => setIsExpanded(true)}
            >
              <Search className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Find or add customer
            </Button>
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="mt-3 border-t border-border/70 pt-3">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                autoFocus
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setInlineError(null);
                }}
                placeholder="Name, phone, or email"
                className="h-9 pl-9 text-sm"
              />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {trimmedSearchQuery && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 px-3 text-xs"
                  disabled={isAddingCustomer || !activeStore}
                  onClick={handleAddFromSearch}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  Add "{trimmedSearchQuery}"
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={() => {
                  setIsExpanded(false);
                  setInlineError(null);
                }}
                aria-label="Close customer lookup"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>

          {inlineError && (
            <p className="mt-2 text-xs text-destructive">{inlineError}</p>
          )}

          {trimmedSearchQuery && searchResults.length > 0 && (
            <div className="mt-2 grid gap-1">
              {searchResults.map((customer) => {
                const customerIdentifier = customer.email || customer.phone;

                return (
                  <button
                    key={customer._id}
                    type="button"
                    className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-transparent px-3 py-2 text-left text-sm hover:border-border hover:bg-white focus:outline-none focus:ring-2 focus:ring-ring"
                    onClick={() => handleSelectCustomer(customer)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-gray-950">
                        {customer.name}
                      </span>
                      {customerIdentifier && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {customerIdentifier}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      Select
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {trimmedSearchQuery && searchResults.length === 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              No matching customer found.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
