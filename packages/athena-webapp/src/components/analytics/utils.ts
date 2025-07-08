import { Analytic } from "~/types";

export const groupAnalytics = (
  analytics: Analytic[],
  options = { groupByProduct: true }
) => {
  return analytics.reduce<
    Record<
      string,
      Record<string, typeof analytics | Record<string, typeof analytics>>
    >
  >((acc, analytic) => {
    const { action, data } = analytic;
    // Create date string in format YYYY-MM-DD
    const day = new Date(analytic._creationTime).toISOString().split("T")[0];

    // Initialize day group if it doesn't exist
    if (!acc[day]) {
      acc[day] = {};
    }

    if (
      options.groupByProduct &&
      ["viewed_product", "view_product"].includes(action) &&
      data?.product
    ) {
      if (!acc[day][action]) {
        acc[day][action] = {};
      }

      const productId = data.product;

      if (!(acc[day][action] as Record<string, typeof analytics>)[productId]) {
        (acc[day][action] as Record<string, typeof analytics>)[productId] = [];
      }

      (acc[day][action] as Record<string, typeof analytics>)[productId].push(
        analytic
      );
    } else {
      if (!acc[day][action]) {
        acc[day][action] = [];
      }

      (acc[day][action] as typeof analytics).push(analytic);
    }

    return acc;
  }, {});
};

export const countGroupedAnalytics = (
  analytics: Analytic[],
  options = { groupByProduct: true }
) => {
  const grouped = groupAnalytics(analytics, options);

  const counts: Record<
    string,
    Record<string, number | Record<string, number>>
  > = {};

  for (const day in grouped) {
    counts[day] = {};

    for (const action in grouped[day]) {
      if (
        options.groupByProduct &&
        ["viewed_product", "view_product"].includes(action)
      ) {
        counts[day][action] = {};
        const productGroups = grouped[day][action] as Record<
          string,
          Analytic[]
        >;

        for (const productId in productGroups) {
          (counts[day][action] as Record<string, number>)[productId] =
            productGroups[productId].length;
        }
      } else {
        counts[day][action] = (grouped[day][action] as Analytic[]).length;
      }
    }
  }

  return counts;
};

export const groupProductViewsByDay = (
  analytics: Analytic[],
  options = { groupByDay: true }
) => {
  const viewProductAnalytics = analytics.filter(
    (analytic) =>
      ["viewed_product", "view_product"].includes(analytic.action) &&
      analytic.data?.product
  );

  if (options.groupByDay) {
    return viewProductAnalytics.reduce<
      Record<string, Record<string, { count: number; lastViewed: number }>>
    >((acc, analytic) => {
      const productId = analytic.data!.product as string;
      // Create date string in format YYYY-MM-DD
      const day = new Date(analytic._creationTime).toISOString().split("T")[0];

      // Initialize day group if it doesn't exist
      if (!acc[day]) {
        acc[day] = {};
      }

      // Initialize or update product data for the day
      if (!acc[day][productId]) {
        acc[day][productId] = { count: 1, lastViewed: analytic._creationTime };
      } else {
        acc[day][productId].count += 1;
        // Update lastViewed time if this analytic is more recent
        if (analytic._creationTime > acc[day][productId].lastViewed) {
          acc[day][productId].lastViewed = analytic._creationTime;
        }
      }

      return acc;
    }, {});
  } else {
    // When not grouping by day, collect views and last viewed time for each product
    return viewProductAnalytics.reduce<
      {
        productId: string;
        productSku: string;
        views: number;
        lastViewed: number;
      }[]
    >((acc, analytic) => {
      const productId = analytic.data!.product as string;
      const productSku = analytic.data!.productSku as string;
      const existingIndex = acc.findIndex(
        (item) => item.productId === productId
      );

      if (existingIndex === -1) {
        // Add new product entry
        acc.push({
          productId,
          productSku,
          views: 1,
          lastViewed: analytic._creationTime,
        });
      } else {
        // Update existing product entry
        acc[existingIndex].views += 1;
        if (analytic._creationTime > acc[existingIndex].lastViewed) {
          acc[existingIndex].lastViewed = analytic._creationTime;
        }
      }
      return acc;
    }, []);
  }
};
