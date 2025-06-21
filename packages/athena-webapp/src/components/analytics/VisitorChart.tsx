import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Clock } from "lucide-react";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface VisitorChartProps {
  visitorData: Record<number, number>;
}

export function VisitorChart({ visitorData }: VisitorChartProps) {
  // Convert 24-hour format to 12-hour AM/PM format
  const formatHour = (hour: number): string => {
    if (hour === 0) return "12 AM";
    if (hour === 12) return "12 PM";
    if (hour < 12) return `${hour} AM`;
    return `${hour - 12} PM`;
  };

  // Convert visitor data to chart format with all 24 hours
  const chartData = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    visitors: visitorData[hour] || 0,
    formattedHour: formatHour(hour),
  }));

  const totalVisitors = Object.values(visitorData).reduce(
    (sum, val) => sum + val,
    0
  );
  const peakHour = Object.entries(visitorData).reduce(
    ([maxHour, maxVisitors], [hour, visitors]) =>
      visitors > maxVisitors ? [hour, visitors] : [maxHour, maxVisitors],
    ["0", 0]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" />
          Visitor Patterns by Hour
        </CardTitle>
      </CardHeader>
      <CardContent>
        {totalVisitors > 0 ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Total Activities</p>
                <p className="font-medium text-lg">{totalVisitors}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Peak Hour</p>
                <p className="font-medium text-lg">
                  {formatHour(parseInt(peakHour[0]))} ({peakHour[1]} activities)
                </p>
              </div>
            </div>

            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <XAxis
                    dataKey="formattedHour"
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    interval={2} // Show every 3rd hour
                  />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    formatter={(value: number) => [value, "Activities"]}
                    labelFormatter={(label) => `Time: ${label}`}
                    contentStyle={{
                      backgroundColor: "hsl(var(--background))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "6px",
                    }}
                  />
                  <Bar
                    dataKey="visitors"
                    fill="hsl(var(--primary))"
                    radius={[2, 2, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="text-xs text-muted-foreground">
              <p>
                Peak activity times help optimize content publishing and
                marketing campaigns
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            <div className="text-center">
              <Clock className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No visitor data available</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
