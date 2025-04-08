import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "~/convex/_generated/api";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { Analytic } from "~/types";

type LogsState = {
  items: Analytic[];
  cursor: string | null;
};

export const useLoadLogItems = (currentCursor: string | null) => {
  const { activeStore } = useGetActiveStore();

  const [data, setData] = useState<LogsState>({
    items: [],
    cursor: null,
  });

  const res = useQuery(
    api.storeFront.analytics.getAllPaginated,
    activeStore?._id
      ? { storeId: activeStore._id, cursor: currentCursor }
      : "skip"
  );

  console.table({ currentCursor, res });

  useEffect(() => {
    if (res?.cursor && !res?.isDone) {
      setData({
        items: [...data.items, ...res.items],
        cursor: res.cursor,
      });
    }
  }, [res?.cursor, res?.isDone]);

  return { ...data, isDone: res?.isDone };
};
