import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import { Card, CardContent, CardHeader } from "../../ui/card";
import { BarChart3, Mail } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { GenericDataTable } from "../../base/table/data-table";
import { analyticsColumns } from "../../analytics/analytics-data-table/analytics-columns";
import CapturedEmails from "../captured/CapturedEmails";
import { useState } from "react";
import { Button } from "../../ui/button";
import { Tabs, TabsList, TabsTrigger } from "../../ui/tabs";

// Define types for view state
type AnalyticsView = "table" | "emails";

// Analytics component for promo codes
const PromoCodeAnalytics = ({
  promoCodeId,
}: {
  promoCodeId: Id<"promoCode">;
}) => {
  // Add state for controlling which view to show
  const [currentView, setCurrentView] = useState<AnalyticsView>("table");

  const analytics = useQuery(api.storeFront.analytics.getByPromoCodeId, {
    promoCodeId,
  });

  if (!analytics) {
    return (
      <div className="flex items-center justify-center h-48">
        <p className="text-muted-foreground">Loading analytics...</p>
      </div>
    );
  }

  if (analytics.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48">
        <BarChart3 className="w-12 h-12 text-muted-foreground mb-2" />
        <p className="text-muted-foreground">
          No analytics data available for this promo code yet
        </p>
      </div>
    );
  }

  // Process analytics data
  const actionCounts = {
    viewed: 0,
    dismissed: 0,
    submitted: 0,
  };

  analytics.forEach((record) => {
    if (record.action.includes("viewed")) {
      actionCounts.viewed++;
    } else if (record.action.includes("dismissed")) {
      actionCounts.dismissed++;
    } else if (record.action.includes("submitted")) {
      actionCounts.submitted++;
    }
  });

  // Prepare data for recharts - create separate entries for each action
  const chartData = [
    { name: "Viewed", value: actionCounts.viewed, fill: "#333333" },
    { name: "Dismissed", value: actionCounts.dismissed, fill: "#333333" },
    { name: "Submitted", value: actionCounts.submitted, fill: "#333333" },
  ];

  // Total interactions
  const totalInteractions =
    actionCounts.viewed + actionCounts.dismissed + actionCounts.submitted;

  // Calculate conversion rate (submitted/viewed)
  const conversionRate =
    actionCounts.viewed > 0
      ? ((actionCounts.submitted / actionCounts.viewed) * 100).toFixed(1)
      : "0";

  return (
    <div className="space-y-6">
      {/* View Toggle */}
      <div className="flex justify-end">
        <Tabs
          value={currentView}
          onValueChange={(value) => setCurrentView(value as AnalyticsView)}
          className="w-auto"
        >
          <TabsList>
            <TabsTrigger value="table" className="flex items-center gap-1">
              <BarChart3 className="h-4 w-4" />
              <span>Analytics</span>
            </TabsTrigger>
            <TabsTrigger value="emails" className="flex items-center gap-1">
              <Mail className="h-4 w-4" />
              <span>Captured Emails</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card className="shadow-none">
          <CardHeader className="pb-4">
            <p className="text-sm text-muted-foreground">Total Interactions</p>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{totalInteractions}</p>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardHeader className="pb-4">
            <p className="text-sm text-muted-foreground">Conversion Rate</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-2xl font-semibold">{conversionRate}%</p>
            <p className="text-xs text-muted-foreground">
              Of users who viewed the code, {conversionRate}% submitted it
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-none border-none">
        <CardHeader>
          <p className="text-sm">Interaction Breakdown</p>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{
                  top: 10,
                  right: 30,
                  left: 0,
                  bottom: 20,
                }}
              >
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} name="Interactions">
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Use consistent height container for both views to prevent layout shift */}
      <div className="min-h-[500px]">
        {currentView === "table" ? (
          <GenericDataTable data={analytics} columns={analyticsColumns} />
        ) : (
          <CapturedEmails promoCodeId={promoCodeId} />
        )}
      </div>
    </div>
  );
};

export default PromoCodeAnalytics;
