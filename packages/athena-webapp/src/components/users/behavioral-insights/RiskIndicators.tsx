import {
  AlertTriangle,
  Clock,
  ShoppingBasket,
  ShoppingCart,
  UserX,
} from "lucide-react";
import { RiskIndicator } from "~/src/lib/behaviorUtils";

interface RiskIndicatorsProps {
  risks: RiskIndicator[];
  className?: string;
}

const getRiskIcon = (type: RiskIndicator["type"]) => {
  switch (type) {
    case "abandoned_cart":
      return ShoppingBasket;
    case "checkout_dropout":
      return ShoppingCart;
    case "inactive_user":
      return UserX;
    default:
      return AlertTriangle;
  }
};

const getRiskStyles = (severity: RiskIndicator["severity"]) => {
  switch (severity) {
    case "high":
      return {
        cardClass: "border-red-200 bg-red-50",
        iconClass: "text-red-800",
        textClass: "text-red-800",
        titleClass: "text-red-900",
      };
    case "medium":
      return {
        cardClass: "border-orange-200 bg-orange-50",
        iconClass: "text-orange-800",
        textClass: "text-orange-800",
        titleClass: "text-orange-900",
      };
    case "low":
      return {
        cardClass: "border-yellow-200 bg-yellow-50",
        iconClass: "text-yellow-800",
        textClass: "text-yellow-800",
        titleClass: "text-yellow-900",
      };
  }
};

export function RiskIndicators({ risks, className }: RiskIndicatorsProps) {
  if (!risks.length) return null;

  const highestSeverity = risks.reduce(
    (max, risk) => {
      const severityOrder = { low: 1, medium: 2, high: 3 };
      return severityOrder[risk.severity] > severityOrder[max]
        ? risk.severity
        : max;
    },
    "low" as RiskIndicator["severity"]
  );

  const styles = getRiskStyles(highestSeverity);

  return (
    <div className="flex items-start gap-3">
      {/* <AlertTriangle
        className={`w-5 h-5 mt-0.5 flex-shrink-0 ${styles.iconClass}`}
      /> */}
      <div className="flex-1 min-w-0">
        <div className="space-y-4">
          {risks.map((risk, index) => {
            const RiskIcon = getRiskIcon(risk.type);
            return (
              <div key={index} className="flex items-center gap-2">
                <RiskIcon
                  className={`w-3.5 h-3.5 flex-shrink-0 ${styles.iconClass}`}
                />
                <p className={`text-sm ${styles.textClass}`}>{risk.message}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
