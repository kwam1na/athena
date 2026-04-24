import { formatStoredAmount } from "~/src/lib/pos/displayAmounts";
import { cn } from "~/src/lib/utils";

interface TotalsDisplayItem {
  label: string;
  value: number;
  formatter: Intl.NumberFormat;
  highlight?: boolean;
}

interface TotalsDisplayProps {
  items: TotalsDisplayItem[];
  density?: "comfortable" | "compact";
}

export const TotalsDisplay = ({
  items,
  density = "comfortable",
}: TotalsDisplayProps) => {
  const isCompact = density === "compact";

  return (
    <div className={cn(isCompact ? "space-y-3" : "space-y-8")}>
      {items.map((item, index) => (
        <div
          key={index}
          className={
            item.highlight
              ? "flex justify-between items-baseline"
              : "flex justify-between"
          }
        >
          <span
            className={cn(
              item.highlight
                ? isCompact
                  ? "text-md"
                  : "text-xl"
                : isCompact
                  ? "text-md text-muted-foreground"
                  : "text-xl",
            )}
          >
            {item.label}
          </span>
          <span
            className={cn(
              "font-semibold",
              item.highlight
                ? isCompact
                  ? "text-2xl"
                  : "text-2xl"
                : isCompact
                  ? "text-xl text-muted-foreground"
                  : "text-xl",
            )}
          >
            {formatStoredAmount(item.formatter, item.value)}
          </span>
        </div>
      ))}
    </div>
  );
};
