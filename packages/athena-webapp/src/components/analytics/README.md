# Enhanced Analytics MVP

This document outlines the MVP implementation of the enhanced analytics system for Athena webapp.

## 🚀 New Features

### 1. Enhanced Analytics Dashboard

- **Location**: `EnhancedAnalyticsView.tsx`
- **Features**:
  - Comprehensive metrics overview (visitors, revenue, conversions)
  - Date range filtering (7d, 30d, 90d, all time)
  - Interactive charts and visualizations
  - Device usage analytics
  - Customer segmentation (new vs returning)

### 2. Conversion Funnel Tracking

- **Component**: `ConversionFunnelChart.tsx`
- **Tracks**: Product Views → Cart → Checkout → Purchase
- **Shows**: Conversion rates at each step and drop-off points

### 3. Revenue Analytics

- **Component**: `RevenueChart.tsx`
- **Features**:
  - Revenue trends over time
  - Average order value
  - Total revenue and order count

### 4. Visitor Pattern Analysis

- **Component**: `VisitorChart.tsx`
- **Features**:
  - Activity by hour of day
  - Peak traffic identification
  - Visitor behavior patterns

## 🔧 Backend Enhancements

### New Convex Functions

#### `getEnhancedAnalytics`

```typescript
// Returns comprehensive analytics overview
{
  overview: {
    uniqueVisitors: number,
    totalViews: number,
    productViews: number,
    cartActions: number,
    checkoutActions: number,
    purchaseActions: number
  },
  conversions: {
    viewToCartRate: number,
    cartToCheckoutRate: number,
    checkoutToPurchaseRate: number,
    overallConversionRate: number
  },
  deviceBreakdown: {
    mobile: number,
    desktop: number,
    unknown: number
  }
}
```

#### `getRevenueAnalytics`

```typescript
// Returns revenue data with trending
{
  totalRevenue: number,
  totalOrders: number,
  averageOrderValue: number,
  revenueByDay: Record<string, number>
}
```

#### `getVisitorInsights`

```typescript
// Returns visitor behavior patterns
{
  totalVisitors: number,
  returningVisitors: number,
  newVisitors: number,
  peakHour: number | null,
  visitorsByHour: Record<number, number>
}
```

#### `getTopProducts`

```typescript
// Returns most viewed products
[
  {
    productId: string,
    views: number,
  },
];
```

## 📊 Enhanced Tracking (Storefront)

### New Tracking Hook: `useEnhancedTracking`

**Location**: `packages/storefront-webapp/src/hooks/useEnhancedTracking.ts`

**Available Functions**:

- `trackProductView(productId, productData)` → "viewed_product"
- `trackAddToCart(productId, quantity, productData)` → "added_product_to_bag"
- `trackRemoveFromCart(productId, quantity)` → "removed_product_from_bag"
- `trackCheckoutStarted(cartValue, itemCount)` → "initiated_checkout"
- `trackCheckoutCompleted(orderId, orderValue)` → "finalized_checkout"
- `trackSearch(query, resultCount)` → "performed_search"
- `trackPageView(pageName, additionalData)` → "viewed_page"
- `trackEmailSignup(source)` → "signed_up_email"
- `trackPromoCodeUsed(promoCode, discount)` → "used_promo_code"
- `trackSavedBagAdd(productId, productData)` → "added_product_to_saved"
- `trackSavedBagRemove(productId)` → "removed_product_from_saved"
- `trackPromoAlertDismissed(promoData)` → "dismissed_promo_alert"
- `trackRewardsAlertDismissed()` → "dismissed_rewards_alert"
- `trackShopNowClicked(origin, additionalData)` → "clicked_shop_now"

**Usage Example**:

```typescript
import { useEnhancedTracking } from "@/hooks/useEnhancedTracking";

const MyComponent = () => {
  const { trackAddToCart, trackProductView } = useEnhancedTracking();

  const handleAddToCart = (productId: string) => {
    // Add to cart logic...
    trackAddToCart(productId, 1, { price: 29.99, category: "electronics" });
  };

  const handleProductView = (productId: string) => {
    trackProductView(productId, { category: "electronics", price: 29.99 });
  };
};
```

## 🎯 How to Use

### 1. Access Enhanced Analytics

- Navigate to `/analytics` in the Athena webapp
- Toggle between "Enhanced" and "Classic" views using the top-right buttons
- Select different date ranges using the dropdown

### 2. Understanding the Metrics

**Key Metrics Cards**:

- **Total Visitors**: Unique users visiting your store
- **Product Views**: Number of product page visits
- **Total Revenue**: Revenue from completed orders
- **Conversion Rate**: Overall views-to-purchase conversion

**Secondary Metrics**:

- **Cart Actions**: Products added to cart
- **Checkouts Started**: Users who initiated checkout
- **Average Order Value**: Revenue per order
- **Device Split**: Mobile vs desktop usage

### 3. Chart Interpretation

**Conversion Funnel**:

- Shows the customer journey from viewing products to purchasing
- Identifies where customers drop off
- Provides conversion rates between each step

**Revenue Trends**:

- Line chart showing daily revenue over time
- Helps identify seasonal patterns and growth trends

**Visitor Patterns**:

- Bar chart showing activity by hour
- Helps optimize content publishing and marketing timing

## 🔮 Next Steps

### Immediate Improvements (Next Sprint)

1. **Real-time Dashboard**: Live visitor counts and sales
2. **Customer Segmentation**: Advanced cohort analysis
3. **Product Performance**: Individual product analytics
4. **Email Campaign Tracking**: Newsletter and email effectiveness

### Medium-term Enhancements

1. **A/B Testing Framework**: Built-in testing capabilities
2. **Geographic Analytics**: Location-based insights
3. **Predictive Analytics**: AI-powered forecasting
4. **Custom Reports**: Exportable analytics reports

### Long-term Vision

1. **Machine Learning Insights**: Automated recommendations
2. **Competitive Intelligence**: Market analysis tools
3. **Advanced Attribution**: Multi-touch attribution modeling
4. **Integration Hub**: Connect with external analytics tools

## 🐛 Troubleshooting

### Common Issues

**1. No Data Showing**

- Ensure analytics tracking is implemented in storefront
- Check that the store has recent activity
- Verify date range selection

**2. Charts Not Loading**

- Check browser console for errors
- Ensure Recharts library is properly installed
- Verify data format in backend responses

**3. Incorrect Conversion Rates**

- Verify action names match between tracking and analytics functions
- Check that all funnel steps are being tracked properly
- Ensure order completion tracking is implemented

### Getting Help

- Check the Convex console for backend errors
- Review browser network tab for API failures
- Ensure all required dependencies are installed

## 📈 Performance Notes

- Analytics queries are optimized with limits and indexing
- Charts are rendered client-side for better performance
- Date filtering reduces data transfer and processing time
- Responsive design ensures good performance on all devices

---

_This MVP provides a solid foundation for data-driven decision making. Continue iterating based on user feedback and business needs._
