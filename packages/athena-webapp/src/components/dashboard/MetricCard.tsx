import { ArrowUp, ArrowDown } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";

const MetricCard = ({
  label,
  value,
  change,
  changeLabel,
}: {
  label: string;
  value: string;
  change: number;
  changeLabel?: string;
}) => (
  <Card className="flex flex-col justify-between h-full">
    <CardHeader className="pb-2">
      <CardDescription className="text-xs mb-2">{label}</CardDescription>
      <CardTitle className="text-3xl font-bold tracking-tight">
        {value}
      </CardTitle>
    </CardHeader>
    <CardContent className="pt-0 flex items-center gap-2">
      {change !== 0 && (
        <span
          className={
            change > 0
              ? "text-green-500 flex items-center"
              : "text-red-500 flex items-center"
          }
        >
          {change > 0 ? (
            <ArrowUp className="w-4 h-4 mr-1" />
          ) : (
            <ArrowDown className="w-4 h-4 mr-1" />
          )}
          {Math.abs(change).toFixed(2)}%
        </span>
      )}
      {changeLabel && (
        <span className="text-xs text-muted-foreground">{changeLabel}</span>
      )}
    </CardContent>
  </Card>
);

export default MetricCard;
