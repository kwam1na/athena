import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReportTrendPoint } from "~/shared/reportsContract";
import { formatOperatingDate, formatReportMoney } from "./reportFormat";

const STATUS_DOT_COLOR: Record<ReportTrendPoint["status"], string> = {
  open: "hsl(var(--muted-foreground))",
  provisional: "hsl(var(--warning))",
  reconciled: "hsl(var(--success))",
  amended: "hsl(var(--destructive))",
};

export function ReportTrendChart({
  dailyTrend,
  currency,
}: {
  dailyTrend: ReportTrendPoint[];
  currency: string;
}) {
  const chartData = dailyTrend.map((point) => ({
    ...point,
    label: formatOperatingDate(point.operatingDate),
  }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">
          Net sales — last 30 days
        </CardTitle>
      </CardHeader>
      <CardContent className="h-64">
        {chartData.length === 0 ? (
          <p className="text-sm text-muted-foreground">No trend data yet.</p>
        ) : (
          <ResponsiveContainer height="100%" width="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis axisLine={false} dataKey="label" tickLine={false} />
              <YAxis
                axisLine={false}
                tickFormatter={(value: number) => formatReportMoney(value, currency)}
                tickLine={false}
                width={90}
              />
              <Tooltip
                formatter={(value: number) => [
                  formatReportMoney(value, currency),
                  "Net sales",
                ]}
                labelFormatter={(_label, payload) =>
                  payload?.[0]?.payload?.operatingDate ?? ""
                }
              />
              <Line
                dataKey="netSalesMinor"
                dot={(props) => {
                  const status = props.payload.status as ReportTrendPoint["status"];
                  return (
                    <circle
                      cx={props.cx}
                      cy={props.cy}
                      fill={STATUS_DOT_COLOR[status]}
                      key={`dot-${props.payload.operatingDate}`}
                      r={3}
                    />
                  );
                }}
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                type="monotone"
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
