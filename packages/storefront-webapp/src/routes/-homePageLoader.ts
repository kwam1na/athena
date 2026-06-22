import {
  getHomepageSnapshot,
  type HomepageSnapshotV1,
} from "@/api/homepageSnapshot";

type LoaderData<T> = {
  data: T;
  updatedAt: number;
};

export type HomePageLoaderData = {
  snapshot: LoaderData<HomepageSnapshotV1>;
};

export async function loadHomePageData({
  snapshotRequest = getHomepageSnapshot,
}: {
  snapshotRequest?: typeof getHomepageSnapshot;
} = {}): Promise<HomePageLoaderData> {
  const updatedAt = Date.now();
  const snapshot = await snapshotRequest({ asNewUser: false });

  return {
    snapshot: {
      data: snapshot,
      updatedAt,
    },
  };
}
