import { usePosTransactionQueries } from "@/lib/queries/posTransaction";
import { createFileRoute, useParams } from "@tanstack/react-router";
import { PosReceiptPage } from "../../-PosReceiptPage";

export const Route = createFileRoute("/shop/receipt/s/$token/")({
  component: () => <ReceiptShareRoute />,
});

export const ReceiptShareRoute = () => {
  const { token } = useParams({ strict: false }) as { token?: string };
  const posTransactionQueries = usePosTransactionQueries();

  return (
    <PosReceiptPage
      queryOptions={posTransactionQueries.receiptShare(token || "")}
    />
  );
};
