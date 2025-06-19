import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Clock,
  Users,
  ShoppingCart,
  PauseCircle,
  PlayCircle,
  Plus,
  CheckCircle,
} from "lucide-react";

export function SessionDemo() {
  return (
    <div className="p-6 space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold">🎯 POS Session Management</h2>
        <p className="text-muted-foreground">
          Complete session hold/resume functionality for busy retail
          environments
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Active Session */}
        <Card className="border-green-200 bg-green-50">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Clock className="h-4 w-4 text-green-600" />
                Active Session
              </CardTitle>
              <Badge variant="outline" className="bg-green-100 text-green-700">
                SES-001
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">John Smith</span>
            </div>
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">3 items • $45.99</span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="flex-1">
                <PauseCircle className="h-3 w-3 mr-1" />
                Hold
              </Button>
              <Button size="sm" className="flex-1">
                <CheckCircle className="h-3 w-3 mr-1" />
                Complete
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Held Session 1 */}
        <Card className="border-yellow-200 bg-yellow-50">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <PauseCircle className="h-4 w-4 text-yellow-600" />
                Held Session
              </CardTitle>
              <Badge
                variant="outline"
                className="bg-yellow-100 text-yellow-700"
              >
                SES-002
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">Sarah Johnson</span>
            </div>
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">7 items • $128.50</span>
            </div>
            <p className="text-xs text-muted-foreground italic">
              "Customer went to get more cash"
            </p>
            <div className="text-xs text-muted-foreground">
              Held 5 minutes ago
            </div>
            <Button size="sm" variant="outline" className="w-full">
              <PlayCircle className="h-3 w-3 mr-1" />
              Resume
            </Button>
          </CardContent>
        </Card>

        {/* Held Session 2 */}
        <Card className="border-yellow-200 bg-yellow-50">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <PauseCircle className="h-4 w-4 text-yellow-600" />
                Held Session
              </CardTitle>
              <Badge
                variant="outline"
                className="bg-yellow-100 text-yellow-700"
              >
                SES-003
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">Mike Wilson</span>
            </div>
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">2 items • $89.99</span>
            </div>
            <p className="text-xs text-muted-foreground italic">
              "Price check needed"
            </p>
            <div className="text-xs text-muted-foreground">
              Held 12 minutes ago
            </div>
            <Button size="sm" variant="outline" className="w-full">
              <PlayCircle className="h-3 w-3 mr-1" />
              Resume
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* New Session Button */}
      <div className="flex justify-center">
        <Button variant="outline" className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Start New Session
        </Button>
      </div>

      {/* Features List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">✨ Key Features</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h4 className="font-medium flex items-center gap-2">
                <PauseCircle className="h-4 w-4 text-blue-600" />
                Hold & Resume
              </h4>
              <p className="text-sm text-muted-foreground">
                Pause transactions when customers step away or need assistance
              </p>
            </div>
            <div className="space-y-2">
              <h4 className="font-medium flex items-center gap-2">
                <Users className="h-4 w-4 text-green-600" />
                Customer Linking
              </h4>
              <p className="text-sm text-muted-foreground">
                Automatically preserve customer information across sessions
              </p>
            </div>
            <div className="space-y-2">
              <h4 className="font-medium flex items-center gap-2">
                <ShoppingCart className="h-4 w-4 text-purple-600" />
                Cart Persistence
              </h4>
              <p className="text-sm text-muted-foreground">
                Save cart contents, quantities, and pricing information
              </p>
            </div>
            <div className="space-y-2">
              <h4 className="font-medium flex items-center gap-2">
                <Clock className="h-4 w-4 text-orange-600" />
                Session Tracking
              </h4>
              <p className="text-sm text-muted-foreground">
                Track session timing and hold reasons for better service
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Use Cases */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">🏪 Real-World Use Cases</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="border-l-4 border-blue-500 pl-4">
              <h4 className="font-medium">Customer Steps Away</h4>
              <p className="text-sm text-muted-foreground">
                Customer realizes they forgot their wallet and needs to go to
                their car
              </p>
            </div>
            <div className="border-l-4 border-green-500 pl-4">
              <h4 className="font-medium">Price Check Required</h4>
              <p className="text-sm text-muted-foreground">
                Item needs manager approval or price verification from another
                department
              </p>
            </div>
            <div className="border-l-4 border-purple-500 pl-4">
              <h4 className="font-medium">Multiple Customers</h4>
              <p className="text-sm text-muted-foreground">
                Handle multiple customers simultaneously during busy periods
              </p>
            </div>
            <div className="border-l-4 border-orange-500 pl-4">
              <h4 className="font-medium">Phone Interruption</h4>
              <p className="text-sm text-muted-foreground">
                Important call comes in that requires immediate attention
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
