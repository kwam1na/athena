import { formatStoredAmount } from "~/src/lib/pos/displayAmounts";

interface TotalsDisplayItem {
  label: string;
  value: number;
  formatter: Intl.NumberFormat;
  highlight?: boolean;
}

interface TotalsDisplayProps {
  items: TotalsDisplayItem[];
}

export const TotalsDisplay = ({ items }: TotalsDisplayProps) => {
  return (
    <div className="space-y-8">
      {items.map((item, index) => (
        <div
          key={index}
          className={
            item.highlight
              ? "flex justify-between items-baseline"
              : "flex justify-between"
          }
        >
          <span className={item.highlight ? "text-xl" : "text-lg"}>
            {item.label}
          </span>
          <span
            className={
              item.highlight
                ? "text-4xl font-semibold"
                : "text-3xl font-semibold"
            }
          >
            {formatStoredAmount(item.formatter, item.value)}
          </span>
        </div>
      ))}
    </div>
  );
};
