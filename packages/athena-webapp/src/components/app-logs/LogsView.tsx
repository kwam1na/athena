import { useQuery } from "convex/react";
import View from "../View";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import LogItems from "./LogItems";
import { useEffect, useState } from "react";
import { Analytic } from "~/types";
import { Button } from "../ui/button";
import { LogItemsProvider } from "./analytics-data-table/log-items-provider";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Check, Circle, Minus } from "lucide-react";
import { DashIcon } from "@radix-ui/react-icons";

type LogsState = {
  items: Analytic[];
  cursor: string | null;
};

const Navigation = () => {
  return (
    <div className="container mx-auto flex gap-2 h-[40px]">
      <div className="flex items-center">
        <p className="text-3xl font-medium">Logs</p>
      </div>
    </div>
  );
};

function Body() {
  const { activeStore } = useGetActiveStore();

  const [data, setData] = useState<LogsState>({
    items: [],
    cursor: null,
  });

  const [currentCursor, setCurrentCursor] = useState<string | null>(null);

  const [selectedLog, setSelectedLog] = useState<Analytic | null>(null);

  const [pageIndex, setPageIndex] = useState(0);

  const res = useQuery(
    api.storeFront.analytics.getAllPaginated,
    activeStore?._id
      ? {
          storeId: activeStore._id,
          cursor: currentCursor,
          action: "log_message",
        }
      : "skip"
  );

  useEffect(() => {
    if (res?.cursor) {
      setData({
        items: [...data.items, ...res.items],
        cursor: res.cursor,
      });
    }
  }, [res?.cursor, res?.isDone]);

  const analytics = res?.items;
  const isDone = res?.isDone;
  const cursor = res?.cursor;

  if (!analytics) return null;

  const items = data.items.sort((a, b) => b._creationTime - a._creationTime);

  const session =
    selectedLog?.data?.vars?.session || selectedLog?.data?.vars.activeSession;

  const logMessage = selectedLog?.data?.message;

  return (
    <>
      <LogItemsProvider
        loadMore={() => {
          if (isDone || !cursor) return;

          setCurrentCursor(cursor);
          setPageIndex(pageIndex + 1);
        }}
        selectedLog={selectedLog}
        setSelectedLog={setSelectedLog}
      >
        <Sheet open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
          <SheetContent className="w-[100vw]">
            <div className="py-4 overflow-x-auto h-screen pb-16 overflow-y-auto">
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <p className="font-medium">{logMessage}</p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    {session?.hasCompletedPayment ? (
                      <Check className="w-4 h-4 text-green-700" />
                    ) : (
                      <Minus className="w-4 h-4" />
                    )}
                    <p className="font-medium text-sm">Completed payment</p>
                  </div>

                  <div className="flex items-center gap-2">
                    {session?.hasVerifiedPayment ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <Minus className="w-4 h-4" />
                    )}
                    <p className="font-medium text-sm">Verified payment</p>
                  </div>
                </div>

                <div className="space-y-4">
                  {Object.entries(session || {}).map(([key, value]) => (
                    <div
                      key={key}
                      className="grid grid-cols-2 border border-gray-200 overflow-x-auto rounded-md p-4"
                    >
                      <p className="text-sm text-muted-foreground">{key}</p>
                      <p className="text-sm">{JSON.stringify(value)}</p>
                    </div>
                  ))}
                </div>

                {/* <pre className="whitespace-pre-wrap break-words">
                  {JSON.stringify(selectedLog?.data, null, 2)}
                </pre> */}
              </div>
            </div>
          </SheetContent>
          <LogItems items={items} pageIndex={pageIndex} />
        </Sheet>
      </LogItemsProvider>
    </>
  );
}

export default function LogsView() {
  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="bg-background"
      header={<Navigation />}
    >
      <Body />
    </View>
  );
}
