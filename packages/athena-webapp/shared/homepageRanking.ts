export type HomepageRankedItem = {
  _id?: unknown;
  id?: unknown;
  rank?: number;
};

export const HOMEPAGE_UNRANKED_SORT_VALUE = Number.MAX_SAFE_INTEGER;

export const getHomepageSortRank = (item: HomepageRankedItem) => {
  return typeof item.rank === "number"
    ? item.rank
    : HOMEPAGE_UNRANKED_SORT_VALUE;
};

export const getPresentedHomepageRank = (
  _item: HomepageRankedItem,
  fallbackRank: number,
) => {
  return fallbackRank;
};

export const compareHomepageRankedItems = <T extends HomepageRankedItem>(
  a: T,
  b: T,
) => {
  const rankDelta = getHomepageSortRank(a) - getHomepageSortRank(b);
  if (rankDelta !== 0) {
    return rankDelta;
  }

  return String(a._id ?? a.id ?? "").localeCompare(
    String(b._id ?? b.id ?? ""),
  );
};

export const sortHomepageRankedItems = <T extends HomepageRankedItem>(
  items: T[],
) => [...items].sort(compareHomepageRankedItems);

export const getNextHomepageRank = <T extends HomepageRankedItem>(
  items: T[],
) => {
  const rankedRows = items.filter(
    (item): item is T & { rank: number } => typeof item.rank === "number",
  );

  if (!rankedRows.length) {
    return items.length;
  }

  return Math.max(...rankedRows.map((item) => item.rank)) + 1;
};
