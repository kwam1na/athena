import { getPosTransactionByReceiptToken } from "@/api/posTransaction";
import { queryOptions } from "@tanstack/react-query";
import { useQueryEnabled } from "@/hooks/useQueryEnabled";

export const usePosTransactionQueries = () => {
  const queryEnabled = useQueryEnabled();

  return {
    receiptShare: (token: string) =>
      queryOptions({
        queryKey: ["pos-transaction", "receipt-share", token],
        queryFn: () => getPosTransactionByReceiptToken(token),
        enabled: queryEnabled && Boolean(token),
        staleTime: 0,
      }),
  };
};
