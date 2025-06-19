import { useState } from "react";
import View from "../View";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { FadeIn } from "../common/FadeIn";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  ScanBarcode,
  ShoppingCart,
  ArrowLeft,
  User,
  Receipt,
  CreditCard,
} from "lucide-react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useGetActiveOrganization } from "@/hooks/useGetOrganizations";

const Navigation = () => {
  const { activeOrganization, activeStore } = {
    activeOrganization: useGetActiveOrganization().activeOrganization,
    activeStore: useGetActiveStore().activeStore,
  };

  if (!activeOrganization || !activeStore) return null;

  return (
    <div className="container mx-auto flex justify-between items-center h-[60px] px-4">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="sm" asChild>
          <Link
            to="/$orgUrlSlug/store/$storeUrlSlug/pos"
            params={{
              orgUrlSlug: activeOrganization.slug,
              storeUrlSlug: activeStore.slug,
            }}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to POS
          </Link>
        </Button>
        <p className="text-xl font-medium">New Transaction</p>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="outline">Ready to Start</Badge>
      </div>
    </div>
  );
};

export function NewTransactionView() {
  const { activeStore } = useGetActiveStore();
  const { activeOrganization } = useGetActiveOrganization();
  const navigate = useNavigate();
  const [customerInfo, setCustomerInfo] = useState({
    name: "",
    email: "",
    phone: "",
  });
  const [registerNumber, setRegisterNumber] = useState("1");
  const [isStarting, setIsStarting] = useState(false);

  if (!activeStore || !activeOrganization) return null;

  const handleStartTransaction = async () => {
    setIsStarting(true);

    try {
      // Here you would call a Convex mutation to start a new POS session/transaction
      // For now, we'll navigate directly to the register

      await new Promise((resolve) => setTimeout(resolve, 1000)); // Simulate API call

      navigate({
        to: "/$orgUrlSlug/store/$storeUrlSlug/pos/register",
        params: {
          orgUrlSlug: activeOrganization.slug,
          storeUrlSlug: activeStore.slug,
        },
      });
    } catch (error) {
      console.error("Failed to start transaction:", error);
    } finally {
      setIsStarting(false);
    }
  };

  const handleQuickStart = () => {
    // Quick start without customer info
    navigate({
      to: "/$orgUrlSlug/store/$storeUrlSlug/pos/register",
      params: {
        orgUrlSlug: activeOrganization.slug,
        storeUrlSlug: activeStore.slug,
      },
    });
  };

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="bg-background"
      header={<Navigation />}
    >
      <FadeIn className="p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Quick Start Section */}
          <Card className="border-2 border-blue-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShoppingCart className="w-5 h-5 text-blue-600" />
                Quick Start
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-lg">
                    Start Sale Immediately
                  </h3>
                  <p className="text-muted-foreground">
                    Begin a new transaction without customer information
                  </p>
                </div>
                <Button
                  size="lg"
                  onClick={handleQuickStart}
                  className="min-w-32"
                >
                  <ScanBarcode className="w-4 h-4 mr-2" />
                  Start Now
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Customer Information */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="w-5 h-5" />
                  Customer Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="customer-name">Customer Name</Label>
                  <Input
                    id="customer-name"
                    placeholder="Enter customer name"
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
                  <Label htmlFor="customer-email">Email (Optional)</Label>
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
                  <Label htmlFor="customer-phone">Phone (Optional)</Label>
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

                <Button variant="outline" className="w-full">
                  <User className="w-4 h-4 mr-2" />
                  Search Existing Customer
                </Button>
              </CardContent>
            </Card>

            {/* Transaction Settings */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Receipt className="w-5 h-5" />
                  Transaction Settings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="register-number">Register Number</Label>
                  <Input
                    id="register-number"
                    value={registerNumber}
                    onChange={(e) => setRegisterNumber(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Transaction Type</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" className="justify-start">
                      <CreditCard className="w-4 h-4 mr-2" />
                      Regular Sale
                    </Button>
                    <Button
                      variant="outline"
                      className="justify-start"
                      disabled
                    >
                      <Receipt className="w-4 h-4 mr-2" />
                      Return
                    </Button>
                  </div>
                </div>

                <Separator />

                <div className="space-y-2">
                  <Label>Today's Summary</Label>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Transactions</p>
                      <p className="font-medium">0</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Total Sales</p>
                      <p className="font-medium">$0.00</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Start Transaction Button */}
          <Card>
            <CardContent className="pt-6">
              <Button
                size="lg"
                className="w-full"
                onClick={handleStartTransaction}
                disabled={isStarting}
              >
                {isStarting ? (
                  "Starting Transaction..."
                ) : (
                  <>
                    <ShoppingCart className="w-4 h-4 mr-2" />
                    Start Transaction with Customer Info
                  </>
                )}
              </Button>
              <p className="text-sm text-muted-foreground text-center mt-2">
                This will create a new transaction and take you to the register
              </p>
            </CardContent>
          </Card>
        </div>
      </FadeIn>
    </View>
  );
}
