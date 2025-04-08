import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { ArrowLeftIcon, Check, Minus } from "lucide-react";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import View from "../View";
import PageHeader from "../common/PageHeader";
import { Button } from "../ui/button";

const Header = () => {
  const { o } = useSearch({ strict: false });

  const navigate = useNavigate();

  const handleBackClick = () => {
    if (o) {
      navigate({ to: o });
    } else {
      navigate({
        to: `/$orgUrlSlug/store/$storeUrlSlug/logs`,
        params: (prev) => ({
          ...prev,
          storeUrlSlug: prev.storeUrlSlug!,
          orgUrlSlug: prev.orgUrlSlug!,
        }),
      });
    }
  };

  return (
    <PageHeader>
      <div className="flex gap-4 items-center">
        <div className="flex items-center gap-2">
          <Button
            onClick={handleBackClick}
            variant="ghost"
            className="h-8 px-2 lg:px-3 "
          >
            <ArrowLeftIcon className="h-4 w-4" />
          </Button>
        </div>

        <p className="text-sm">{`Log`}</p>

        {/* <p className="text-xs text-muted-foreground">
          {`placed ${getRelativeTime(order._creationTime)}`}
        </p> */}
      </div>
    </PageHeader>
  );
};

export function LogView() {
  const { logId } = useParams({ strict: false });

  const log = useQuery(
    api.storeFront.analytics.get,
    logId ? { id: logId as Id<"analytics"> } : "skip"
  );

  const logMessage = log?.data?.message;
  // const session = log?.data?.vars?.session || log?.data?.vars?.activeSession;

  const {
    session: s,
    activeSession,
    checkoutState,
    ...rest
  } = log?.data?.vars || {};

  const { bag } = checkoutState || {};

  const session = s || activeSession;

  return (
    <View header={<Header />}>
      <div className="container mx-auto p-8 overflow-x-auto h-full pb-16 overflow-y-auto">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-8">
            <div className="space-y-4">
              <p className="font-medium">{logMessage}</p>

              {/* <div className="space-y-2">
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
              </div> */}
            </div>

            <div className="space-y-4">
              <p>Checkout session details</p>
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
          </div>

          {/* <pre className="whitespace-pre-wrap break-words">
            {JSON.stringify(rest, null, 2)}
          </pre> */}

          {rest && Object.keys(rest).length > 0 && (
            <div className="space-y-4">
              <p>Checkout complete step details</p>
              {Object.entries(rest || {}).map(([key, value]) => (
                <div
                  key={key}
                  className="grid grid-cols-2 border border-gray-200 overflow-x-auto rounded-md p-4"
                >
                  <p className="text-sm text-muted-foreground">{key}</p>
                  <p className="text-sm">{JSON.stringify(value)}</p>
                </div>
              ))}
            </div>
          )}

          {bag && Object.keys(bag).length > 0 && (
            <div className="space-y-4">
              <p>Bag details</p>
              {Object.entries(bag || {}).map(([key, value]) => (
                <div
                  key={key}
                  className="grid grid-cols-2 border border-gray-200 overflow-x-auto rounded-md p-4"
                >
                  <p className="text-sm text-muted-foreground">{key}</p>
                  <p className="text-sm">{JSON.stringify(value)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </View>
  );
}
