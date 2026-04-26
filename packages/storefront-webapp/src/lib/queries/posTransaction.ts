import { getPosTransaction } from "@/api/posTransaction";
import { queryOptions } from "@tanstack/react-query";
import { useQueryEnabled } from "@/hooks/useQueryEnabled";

export const usePosTransactionQueries = () => {
  const queryEnabled = useQueryEnabled();

  return {
    detail: (transactionId: string) =>
      queryOptions({
        queryKey: ["pos-transaction", "detail", transactionId],
        queryFn: () => getPosTransaction(transactionId),
        enabled: queryEnabled && Boolean(transactionId),
        staleTime: 0,
      }),
  };
};
