import { useEffect } from "react";

import { useStoreContext } from "@/contexts/StoreContext";
import { usePosTransactionQueries } from "@/lib/queries/posTransaction";
import { toDisplayAmount } from "@/lib/currency";
import { getStoreConfigV2 } from "@/lib/storeConfig";
import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

export const Route = createFileRoute("/shop/receipt/$transactionId/")({
  component: () => <PosReceiptPage />,
});

const paymentLabel = (method: string) => {
  if (method === "cash") return "Cash";
  if (method === "card") return "Card";
  if (method === "mobile_money") return "Mobile Money";

  return method.replace("_", " ");
};

export const PosReceiptPage = () => {
  const { formatter, store, hideNavbar, showNavbar } = useStoreContext();
  const { transactionId } = useParams({ strict: false });
  const storeConfig = getStoreConfigV2(store);
  const posTransactionQueries = usePosTransactionQueries();

  useEffect(() => {
    hideNavbar();

    return () => {
      showNavbar();
    };
  }, [hideNavbar, showNavbar]);

  const { data, isLoading } = useQuery({
    ...posTransactionQueries.detail(transactionId || ""),
    retry: (failureCount, error) => {
      if (failureCount >= 2) {
        return false;
      }

      if (error && typeof error === "object" && "status" in error) {
        return (error as { status?: number }).status != null && (error as { status?: number }).status! >= 500;
      }

      return error instanceof TypeError;
    },
  });

  const money = (value?: number) => formatter.format(toDisplayAmount(value ?? 0));

  if (isLoading) {
    return <div className="h-screen" />;
  }

  if (!data) {
    return (
      <main className="h-screen bg-white flex items-center justify-center px-4">
        <article
          className="w-80 border border-dashed border-black p-4 text-black"
          style={{
            fontFamily: '"Courier New", Courier, monospace',
          }}
        >
          <p className="text-center text-[28px] leading-none font-black tracking-[1px] uppercase">
            Receipt
          </p>
          <div className="my-3 border-t border-dashed border-black" />
          <p className="text-center text-xs">Not Found</p>
          <div className="my-3 border-t border-dashed border-black" />
          <p className="text-center text-xs">We could not find this receipt.</p>
        </article>
      </main>
    );
  }

  const completedDateTime = new Date(data.completedAt);
  const completedDate = completedDateTime.toLocaleDateString();
  const completedTime = completedDateTime.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const cashierName = data.cashier
    ? `${data.cashier.firstName || ""} ${data.cashier.lastName || ""}`.trim()
    : "Unassigned";
  const registerNumber = data.registerNumber || "Unassigned";
  const itemsCount = data.items.reduce((sum, item) => sum + item.quantity, 0);
  const totalPaidFromPayments = data.payments.reduce(
    (sum, payment) => sum + payment.amount,
    0,
  );
  const changeGiven =
    data.changeGiven ??
    (totalPaidFromPayments > data.total ? totalPaidFromPayments - data.total : 0);

  const locationParts = (storeConfig.contact.location || "").split(",").map((part) => part.trim()).filter(Boolean);
  const [street, city, state, zipCode, country] = locationParts;

  return (
    <main className="min-h-screen h-screen bg-white flex items-center justify-center px-4 py-8">
      <style>{`
        .receipt-shell {
          width: 320px;
          max-width: calc(100vw - 2rem);
          margin: 0 auto;
          color: #111;
          font-family: "Courier New", Courier, monospace;
        }
        .receipt {
          border: 1px solid #111;
          border-radius: 0;
          padding: 18px 14px;
          background: #fff;
        }
        .line {
          height: 1px;
          border-top: 1px dashed #111;
          margin: 12px 0;
        }
        .section-title {
          border-bottom: 1px solid #111;
          font-weight: 700;
          font-size: 10px;
          letter-spacing: 1.4px;
          text-transform: uppercase;
          margin-bottom: 8px;
          padding-bottom: 4px;
        }
        .row {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
          margin-bottom: 5px;
          font-size: 12px;
        }
        .row-label {
          color: #444;
          font-weight: 700;
          text-transform: uppercase;
        }
        .row-value {
          font-weight: 700;
          text-align: right;
        }
        .item-block {
          border-bottom: 1px dotted #888;
          padding-bottom: 10px;
          margin-bottom: 10px;
        }
        .item-top {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          font-weight: 700;
          font-size: 12px;
        }
        .item-meta {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          font-size: 10px;
          text-transform: uppercase;
          color: #555;
        }
        .small-muted {
          color: #555;
          font-size: 10px;
        }
        @media print {
          .print-root {
            min-height: auto;
            margin: 0;
            padding: 0;
          }
          .receipt-shell {
            width: 100%;
            max-width: 100%;
          }
        }
      `}</style>

      <article className="receipt-shell print-root">
        <div className="receipt">
          <header className="space-y-2">
            <div className="text-center">
              <p className="text-[22px] leading-6 font-black uppercase">
                {store?.name || "Store"}
              </p>
              <div className="small-muted mt-1">
                {street ? <p>{street}</p> : null}
                {city || state || zipCode ? (
                  <p>{[city, state, zipCode].filter(Boolean).join(", ")}</p>
                ) : null}
                {country ? <p>{country}</p> : null}
                {storeConfig.contact.phoneNumber ? (
                  <p>Tel {storeConfig.contact.phoneNumber}</p>
                ) : null}
              </div>
            </div>
            <div className="line" />
          </header>

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[12px] font-bold">
                {completedDate} {completedTime}
              </p>
              <p className="text-[12px] tracking-[1.3px]">#{data.transactionNumber}</p>
            </div>
            <p className="text-[12px]">Cashier: {cashierName}</p>
            <p className="small-muted text-[11px]">Register: {registerNumber}</p>
          </section>

          <div className="line" />

          <section className="space-y-3">
            <h2 className="section-title">Items</h2>
            <p className="text-xs tracking-[1px] text-[#444]">
              {itemsCount} item{itemsCount === 1 ? "" : "s"}
            </p>
            {data.items.map((item) => (
              <div key={item._id} className="item-block">
                <div className="item-top">
                  <span>{item.productName.toUpperCase()}</span>
                  <span>{money(item.totalPrice)}</span>
                </div>
                <div className="item-meta">
                  <span>{`${item.quantity} x ${money(item.unitPrice)}`}</span>
                  <span>{item.productSku || item.barcode || ""}</span>
                </div>
              </div>
            ))}
          </section>

          <section className="space-y-2">
            <h2 className="section-title">Summary</h2>
            <div className="row">
              <span className="row-label">Subtotal</span>
              <span className="row-value">{money(data.subtotal)}</span>
            </div>
            <div className="line" />
            <div className="row">
              <span className="row-label" style={{ fontSize: "16px" }}>
                Total
              </span>
              <span className="row-value" style={{ fontSize: "16px" }}>
                {money(data.total)}
              </span>
            </div>
          </section>

          <div className="line" />

          <section className="space-y-2">
            <h2 className="section-title">Payment</h2>
            {data.payments.length > 0
              ? data.payments.map((payment, idx) => (
                  <div className="row" key={`${payment.method}-${idx}`}>
                    <span className="row-label">{paymentLabel(payment.method)}</span>
                    <span className="row-value">{money(payment.amount)}</span>
                  </div>
                ))
              : (
                  <div className="row">
                    <span className="row-label">{paymentLabel(data.paymentMethod || "Unknown")}</span>
                    <span className="row-value">{money(data.total)}</span>
                  </div>
                )}
            <div className="row">
              <span className="row-label">Tendered</span>
              <span className="row-value">{money(totalPaidFromPayments || data.total)}</span>
            </div>
            {changeGiven > 0 ? (
              <div className="row">
                <span className="row-label">Change</span>
                <span className="row-value">{money(changeGiven)}</span>
              </div>
            ) : null}
          </section>

          <div className="mt-4 pt-3 text-center">
            <p className="text-xs font-bold">Thank you for your business!</p>
            <p className="small-muted">Please keep this receipt for your records.</p>
          </div>
        </div>
      </article>
    </main>
  );
};
