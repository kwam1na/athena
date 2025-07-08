# User Behavioral Insights MVP

## Overview

This implementation provides key behavioral insights for users in the Athena webapp, helping store owners understand customer journey stages, identify risks, and track engagement metrics.

## Features

### 1. Customer Journey Stage Detection

- **New Visitor**: Recently discovered the store (< 7 days, minimal activity)
- **Browsing**: Exploring products, viewing multiple items
- **Considering**: Added items to cart, showing purchase intent
- **Converting**: In checkout process, finalizing purchase
- **Customer**: Completed purchases, established relationship

### 2. Risk Indicators

- **Abandoned Cart**: Items in cart for 2+ hours without checkout activity
- **Checkout Dropout**: Started checkout but didn't complete within 1+ hours
- **Inactive User**: No activity for 14+ days despite previous engagement

### 3. Engagement Metrics

- Products viewed (unique count)
- Last activity timing
- Commerce actions (cart, checkout activities)
- Device preference (desktop/mobile/mixed)
- Weekly activity summary

### 4. Enhanced Activity Timeline

- Priority-based highlighting (high/medium/low priority actions)
- Activity summary cards showing weekly metrics
- Visual indicators for important behaviors

## Architecture

### Core Components

#### `UserBehaviorInsights.tsx`

Main orchestrator component that:

- Fetches user activity data efficiently
- Memoizes calculations to prevent unnecessary re-renders
- Handles loading and empty states
- Coordinates all sub-components

#### `CustomerJourneyStage.tsx`

Displays the user's current journey stage with:

- Visual icons and color coding
- Stage descriptions
- Badge indicators

#### `RiskIndicators.tsx`

Shows behavioral risks with:

- Severity-based styling (high/medium/low)
- Actionable insights
- Multiple risk types support

#### `EngagementMetrics.tsx`

Grid of key engagement metrics:

- Product view counts
- Activity timing
- Device preferences
- Commerce action tracking

#### `ActivitySummaryCards.tsx`

Enhanced timeline summary showing:

- Weekly activity overview
- Commerce action highlights
- Product viewing patterns

### Utility Functions (`behaviorUtils.ts`)

#### Efficient Calculations

- **Single-pass processing**: All metrics calculated efficiently in one iteration
- **Memoized results**: Prevents recalculation on re-renders
- **Type-safe**: Full TypeScript support with proper interfaces

#### Key Functions

- `getCustomerJourneyStage()`: Determines user's position in purchase funnel
- `calculateRiskIndicators()`: Identifies actionable behavioral risks
- `calculateEngagementMetrics()`: Computes engagement statistics
- `getActivityPriority()`: Assigns priority levels to activities

## Integration

### UserView Integration

```typescript
// Added to UserView.tsx after contact details
<div className="space-y-8">
  <p className="text-sm font-medium">Behavioral Insights</p>
  <UserBehaviorInsights userId={user._id} />
</div>
```

### Timeline Enhancement

```typescript
// Enhanced UserActivity.tsx with summary cards
<ActivitySummaryCards activities={analytics} />
```

### Priority Highlighting

Timeline events now include priority-based visual styling:

- **High priority**: Red border for checkout/cart actions
- **Medium priority**: Orange border for engagement actions
- **Low priority**: Gray border for general browsing

## Performance Optimizations

### 1. Efficient Data Fetching

- Reuses existing `getAllUserActivity` query
- Minimal additional API calls
- Leverages existing bag item queries

### 2. Memoized Calculations

```typescript
const behaviorData = useMemo(() => {
  // Calculations only run when activities change
  return {
    journeyStage: getCustomerJourneyStage(activities),
    risks: calculateRiskIndicators(activities, bagItemsCount),
    metrics: calculateEngagementMetrics(activities),
  };
}, [activities, bagItems?.length]);
```

### 3. Conditional Rendering

- Risk indicators only render when risks exist
- Empty states prevent unnecessary DOM updates
- Skeleton loading for smooth UX

## Usage Examples

### Basic Implementation

```typescript
import { UserBehaviorInsights } from './behavioral-insights';

<UserBehaviorInsights userId={userId} />
```

### Individual Components

```typescript
import {
  CustomerJourneyStageCard,
  RiskIndicators,
  EngagementMetricsGrid
} from './behavioral-insights';

// Use components individually if needed
<CustomerJourneyStageCard stage="considering" />
<RiskIndicators risks={calculatedRisks} />
<EngagementMetricsGrid metrics={engagementData} />
```

## Future Enhancements

### Phase 2 Possibilities

- AI-powered insights using existing LLM integration
- Predictive analytics for churn risk
- Personalized marketing recommendations
- Advanced funnel analysis
- Behavioral scoring algorithms

### Scalability Considerations

- All calculations use O(n) complexity
- Memoization prevents redundant processing
- Component architecture supports easy feature additions
- Type-safe interfaces enable confident refactoring

## Testing

The implementation can be tested by:

1. Viewing users with different activity patterns
2. Checking risk indicators with abandoned carts
3. Verifying journey stage detection accuracy
4. Confirming timeline priority highlighting works

## Dependencies

- Existing Convex queries (`getAllUserActivity`, `getAllBagItems`)
- UI components (Card, Badge, Skeleton)
- Lucide React icons
- React hooks (useMemo, useQuery)

No additional external dependencies required!
