import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import * as Collapsible from "@radix-ui/react-collapsible";
import {
  User,
  Search,
  Plus,
  UserPlus,
  Clock,
  Package,
  Edit3,
  Save,
  X,
} from "lucide-react";
import { CustomerInfo } from "./types";
import {
  usePOSCustomerSearch,
  usePOSCustomerCreate,
  usePOSCustomerUpdate,
} from "@/hooks/usePOSCustomers";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { useState } from "react";
import { POS_MESSAGES, showValidationError } from "../../lib/pos/toastService";
import { currencyFormatter } from "~/convex/utils";
import { POSCustomerSummary } from "~/types";

interface CustomerInfoPanelProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  customerInfo: CustomerInfo;
  setCustomerInfo: React.Dispatch<React.SetStateAction<CustomerInfo>>;
}

export function CustomerInfoPanel({
  isOpen,
  onOpenChange,
  customerInfo,
  setCustomerInfo,
}: CustomerInfoPanelProps) {
  const { activeStore } = useGetActiveStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerInfo>({
    name: "",
    email: "",
    phone: "",
  });

  const searchResults = usePOSCustomerSearch(activeStore?._id, searchQuery);
  const createCustomer = usePOSCustomerCreate();
  const updateCustomer = usePOSCustomerUpdate();

  const formatter = currencyFormatter(activeStore?.currency || "GHS");

  const handleSelectCustomer = (customer: POSCustomerSummary) => {
    console.log("🔄 Selecting customer:", customer);

    setCustomerInfo({
      customerId: customer._id,
      name: customer.name,
      email: customer.email || "",
      phone: customer.phone || "",
    });
    setShowSearch(false);
    setSearchQuery("");

    // Keep the panel open so user can see the edit button and customer details
    // onOpenChange(false); // Removed this line

    console.log("✅ Customer selected, panel staying open for editing");
  };

  const handleCreateCustomer = async () => {
    if (!activeStore || !customerInfo.name.trim()) {
      showValidationError([POS_MESSAGES.customer.nameRequired]);
      return;
    }

    const result = await createCustomer({
      storeId: activeStore._id,
      name: customerInfo.name.trim(),
      email: customerInfo.email.trim() || undefined,
      phone: customerInfo.phone.trim() || undefined,
    });

    if (result.success && result.customer) {
      setCustomerInfo({
        customerId: result.customer._id,
        name: result.customer.name,
        email: result.customer.email || "",
        phone: result.customer.phone || "",
      });
      setShowCreateForm(false);
      // Keep the panel open so user can see the edit button and customer details
      // Toast already shown by createCustomer hook
    } else {
      // Error already shown by createCustomer hook
    }
  };

  const handleStartEdit = () => {
    setEditingCustomer({
      customerId: customerInfo.customerId,
      name: customerInfo.name,
      email: customerInfo.email,
      phone: customerInfo.phone,
    });
    setIsEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!editingCustomer.customerId) {
      showValidationError([POS_MESSAGES.customer.noIdForUpdate]);
      return;
    }

    if (!editingCustomer.name.trim()) {
      showValidationError([POS_MESSAGES.customer.nameRequired]);
      return;
    }

    const result = await updateCustomer(editingCustomer.customerId, {
      name: editingCustomer.name.trim(),
      email: editingCustomer.email.trim() || undefined,
      phone: editingCustomer.phone.trim() || undefined,
    });

    if (result.success) {
      setCustomerInfo({
        customerId: editingCustomer.customerId,
        name: editingCustomer.name.trim(),
        email: editingCustomer.email.trim(),
        phone: editingCustomer.phone.trim(),
      });
      setIsEditing(false);
      // Toast already shown by updateCustomer hook
    } else {
      // Error already shown by updateCustomer hook
    }
  };

  const handleCancelEdit = () => {
    setEditingCustomer({
      name: "",
      email: "",
      phone: "",
    });
    setIsEditing(false);
  };

  const clearCustomer = () => {
    setCustomerInfo({ name: "", email: "", phone: "" });
    setSearchQuery("");
    setShowSearch(false);
    setShowCreateForm(false);
    setIsEditing(false);
  };

  return (
    <Collapsible.Root open={isOpen} onOpenChange={onOpenChange}>
      <Collapsible.Content>
        <div className="mb-6 border rounded-lg p-4 bg-muted/20">
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <User className="w-4 h-4" />
              Customer Information
              {customerInfo.customerId && (
                <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">
                  Linked
                </span>
              )}
              {/* Edit button for linked customers */}
              {customerInfo.customerId && !isEditing && !showSearch && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleStartEdit}
                  className="ml-auto h-8 px-3 bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200"
                >
                  <Edit3 className="w-4 h-4 mr-1" />
                  Edit
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Editing Mode */}
            {isEditing && (
              <div className="space-y-4 border rounded-lg p-4 bg-blue-50">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium text-blue-800">
                    Edit Customer Details
                  </h4>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCancelEdit}
                      className="h-7 px-2 text-gray-600 hover:bg-gray-100"
                    >
                      <X className="w-3 h-3 mr-1" />
                      Cancel
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={handleSaveEdit}
                      className="h-7 px-2 bg-blue-600 hover:bg-blue-700"
                    >
                      <Save className="w-3 h-3 mr-1" />
                      Save
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <Label htmlFor="edit-customer-name">Name</Label>
                    <Input
                      id="edit-customer-name"
                      placeholder="Customer name"
                      value={editingCustomer.name}
                      onChange={(e) =>
                        setEditingCustomer((prev) => ({
                          ...prev,
                          name: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="edit-customer-email">Email</Label>
                    <Input
                      id="edit-customer-email"
                      type="email"
                      placeholder="customer@example.com"
                      value={editingCustomer.email}
                      onChange={(e) =>
                        setEditingCustomer((prev) => ({
                          ...prev,
                          email: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="edit-customer-phone">Phone</Label>
                    <Input
                      id="edit-customer-phone"
                      type="tel"
                      placeholder="(555) 123-4567"
                      value={editingCustomer.phone}
                      onChange={(e) =>
                        setEditingCustomer((prev) => ({
                          ...prev,
                          phone: e.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Search Section */}
            {showSearch && !isEditing && (
              <div className="space-y-3 border rounded-lg p-4 bg-muted/20">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                  <Input
                    placeholder="Search customers by name, email, or phone..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                    autoFocus
                  />
                </div>

                {/* Search Results */}
                {searchQuery.trim() && (
                  <div className="max-h-60 overflow-y-auto">
                    {searchResults === undefined ? (
                      <div className="text-center py-4 text-muted-foreground">
                        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                        <p className="text-sm">Searching customers...</p>
                      </div>
                    ) : searchResults.length > 0 ? (
                      <div className="space-y-2">
                        {searchResults.map((customer: POSCustomerSummary) => (
                          <div
                            key={customer._id}
                            className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/50 transition-colors cursor-pointer"
                            onClick={() => handleSelectCustomer(customer)}
                          >
                            <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
                              <User className="w-4 h-4 text-primary" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="font-medium text-sm truncate">
                                {customer.name}
                              </h4>
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                {customer.email && (
                                  <span>{customer.email}</span>
                                )}
                                {customer.phone && (
                                  <span>{customer.phone}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
                                {customer.totalSpent &&
                                  customer.totalSpent > 0 && (
                                    <span className="flex items-center gap-1">
                                      <Package className="w-3 h-3" />
                                      {formatter.format(customer.totalSpent)}
                                    </span>
                                  )}
                                {customer.transactionCount &&
                                  customer.transactionCount > 0 && (
                                    <span className="flex items-center gap-1">
                                      <Clock className="w-3 h-3" />
                                      {customer.transactionCount} transactions
                                    </span>
                                  )}
                              </div>
                            </div>
                            <Button size="sm" variant="outline">
                              Select
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-6 text-muted-foreground">
                        <User className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No customers found</p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-2"
                          onClick={() => {
                            setShowSearch(false);
                            setShowCreateForm(true);
                          }}
                        >
                          <UserPlus className="w-4 h-4 mr-2" />
                          Create New Customer
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Customer Entry Options */}
            {!isEditing && (
              <div className="space-y-4">
                {/* Quick Action Buttons */}
                {!showSearch && (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowSearch(true)}
                      className="flex-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200"
                    >
                      <Search className="w-4 h-4 mr-2" />
                      Search Existing Customer
                    </Button>
                    <Button variant="outline" size="sm" onClick={clearCustomer}>
                      Clear
                    </Button>
                  </div>
                )}

                {/* Cancel Search Button */}
                {showSearch && (
                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setShowSearch(false);
                        setShowCreateForm(false);
                        setSearchQuery("");
                      }}
                    >
                      Cancel Search
                    </Button>
                  </div>
                )}

                {/* Manual Entry Section */}
                {!showSearch && (
                  <div className="space-y-4">
                    <div className="text-sm text-muted-foreground">
                      Or enter customer details manually:
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <Label htmlFor="customer-name">Name</Label>
                        <Input
                          id="customer-name"
                          placeholder="Customer name"
                          value={customerInfo.name}
                          onChange={(e) =>
                            setCustomerInfo((prev) => ({
                              ...prev,
                              name: e.target.value,
                            }))
                          }
                        />
                      </div>
                      <div>
                        <Label htmlFor="customer-email">Email</Label>
                        <Input
                          id="customer-email"
                          type="email"
                          placeholder="customer@example.com"
                          value={customerInfo.email}
                          onChange={(e) =>
                            setCustomerInfo((prev) => ({
                              ...prev,
                              email: e.target.value,
                            }))
                          }
                        />
                      </div>
                      <div>
                        <Label htmlFor="customer-phone">Phone</Label>
                        <Input
                          id="customer-phone"
                          type="tel"
                          placeholder="(555) 123-4567"
                          value={customerInfo.phone}
                          onChange={(e) =>
                            setCustomerInfo((prev) => ({
                              ...prev,
                              phone: e.target.value,
                            }))
                          }
                        />
                      </div>
                    </div>

                    {/* Save Customer Button */}
                    {customerInfo.name.trim() && !customerInfo.customerId && (
                      <div className="flex justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleCreateCustomer}
                          className="bg-green-50 hover:bg-green-100 text-green-700 border-green-200"
                        >
                          <UserPlus className="w-4 h-4 mr-2" />
                          Save as New Customer
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
