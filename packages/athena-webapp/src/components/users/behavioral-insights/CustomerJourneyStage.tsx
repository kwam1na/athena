import { Card, CardContent } from "../../ui/card";
import { Badge } from "../../ui/badge";
import {
  CustomerJourneyStage,
  getJourneyStageInfo,
} from "~/src/lib/behaviorUtils";

interface CustomerJourneyStageProps {
  stage: CustomerJourneyStage;
  className?: string;
}

export function CustomerJourneyStageCard({
  stage,
  className,
}: CustomerJourneyStageProps) {
  const stageInfo = getJourneyStageInfo(stage);

  return (
    <div className="flex items-center justify-between">
      <div className="flex-1">
        {/* <p className="text-xs text-muted-foreground mb-1">Customer Stage</p> */}
        <div className="flex items-center gap-2">
          {/* <span className="text-lg">{stageInfo.icon}</span> */}
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted-foreground">Stage</p>
            <p className="text-sm">{stageInfo.label}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
