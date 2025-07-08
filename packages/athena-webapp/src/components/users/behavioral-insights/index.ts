// Main behavioral insights component
export { UserBehaviorInsights } from "./UserBehaviorInsights";

// Individual insight components
export { CustomerJourneyStageCard } from "./CustomerJourneyStage";
export { RiskIndicators } from "./RiskIndicators";
export { EngagementMetricsGrid } from "./EngagementMetrics";

// Re-export utility types and functions for convenience
export type {
  CustomerJourneyStage,
  RiskIndicator,
  EngagementMetrics,
  BehaviorRiskType,
} from "~/src/lib/behaviorUtils";

export {
  getCustomerJourneyStage,
  calculateRiskIndicators,
  calculateEngagementMetrics,
  getActivityPriority,
  getJourneyStageInfo,
} from "~/src/lib/behaviorUtils";
