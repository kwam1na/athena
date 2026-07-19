import { ColumnDef } from "@tanstack/react-table";

import { DataTableColumnHeader } from "~/src/components/base/table/data-table-column-header";
import { getRelativeTime } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { OnlineOrder } from "~/types";
import {
  Banknote,
  CheckCircle2,
  CreditCardIcon,
  Smartphone,
  AlertCircleIcon,
} from "lucide-react";
import { OrderStatus } from "../../OrderStatus";
import { getOrigin } from "~/src/lib/navigationUtils";
import type { FormattedOnlineOrder } from "../../Orders";
import { OrderCustomerCell } from "./OrderCustomerCell";

export const orderColumns: ColumnDef<OnlineOrder>[] = [
  {
    accessorKey: "orderNumber",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Order" />
    ),
    cell: ({ row }) => {
      const s = window.location.pathname.split("/").pop();

      const order = row.original;

      return (
        <div className="flex space-x-2">
          <Link
            to="/$orgUrlSlug/store/$storeUrlSlug/orders/$orderSlug"
            params={(prev) => ({
              ...prev,
              orgUrlSlug: prev.orgUrlSlug!,
              storeUrlSlug: prev.storeUrlSlug!,
              orderSlug: row.original._id,
            })}
            search={{ orderStatus: s, o: getOrigin() }}
            className="flex items-center gap-8"
          >
            <div className="flex items-center gap-2">
              <span className="font-medium">{`#${row.getValue("orderNumber")}`}</span>
              {order.hasVerifiedPayment &&
                order.paymentMethod?.type !== "payment_on_delivery" && (
                  <CheckCircle2
                    aria-label="Payment verified"
                    className="h-3.5 w-3.5 text-success"
                  />
                )}

              {!order.hasVerifiedPayment &&
                order.paymentMethod?.type !== "payment_on_delivery" && (
                  <AlertCircleIcon
                    aria-label="Payment not verified"
                    className="h-3.5 w-3.5 text-warning"
                  />
                )}
            </div>
          </Link>
        </div>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    cell: ({ row }) => {
      const order = row.original;

      const amountRefunded =
        order?.refunds?.reduce((acc, refund) => acc + refund.amount, 0) || 0;

      const isPartiallyRefunded =
        amountRefunded > 0 &&
        amountRefunded < (order as unknown as FormattedOnlineOrder).amountValue;

      let status: string = row.getValue("status");

      if (status == "refunded") {
        if (isPartiallyRefunded) {
          status = "partially refunded";
        }
      }

      const s = window.location.pathname.split("/").pop();

      return (
        <Link
          to="/$orgUrlSlug/store/$storeUrlSlug/orders/$orderSlug"
          params={(prev) => ({
            ...prev,
            orgUrlSlug: prev.orgUrlSlug!,
            storeUrlSlug: prev.storeUrlSlug!,
            orderSlug: row.original._id,
          })}
          search={{ orderStatus: s, o: getOrigin() }}
        >
          <OrderStatus order={order} />
        </Link>
      );
    },
    enableSorting: false,
    enableHiding: false,
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id));
    },
  },
  {
    accessorKey: "customerDetails",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Customer" />
    ),
    cell: OrderCustomerCell,
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "amount",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Payment" />
    ),
    cell: ({ row }) => {
      const order = row.original;
      const s = window.location.pathname.split("/").pop();
      const isPODOrder =
        order.isPODOrder || order.paymentMethod?.type === "payment_on_delivery";
      const podMethod =
        order.podPaymentMethod ||
        order.paymentMethod?.podPaymentMethod ||
        "cash";
      const paymentMethod = isPODOrder
        ? podMethod === "mobile_money"
          ? "mobile_money"
          : "cash"
        : order.paymentMethod?.channel === "mobile_money"
          ? "mobile_money"
          : "card";
      const paymentLabel =
        paymentMethod === "mobile_money"
          ? "Mobile Money"
          : paymentMethod === "cash"
            ? "Cash"
            : "Card";
      const PaymentIcon =
        paymentMethod === "mobile_money"
          ? Smartphone
          : paymentMethod === "cash"
            ? Banknote
            : CreditCardIcon;

      return (
        <Link
          to="/$orgUrlSlug/store/$storeUrlSlug/orders/$orderSlug"
          params={(prev) => ({
            ...prev,
            orgUrlSlug: prev.orgUrlSlug!,
            storeUrlSlug: prev.storeUrlSlug!,
            orderSlug: row.original._id,
          })}
          search={{ orderStatus: s, o: getOrigin() }}
          className="flex items-center gap-2"
        >
          <span>{row.getValue("amount")}</span>
          <PaymentIcon
            aria-label={paymentLabel}
            className="h-4 w-4 text-muted-foreground"
          />
        </Link>
      );
    },
    sortingFn: (a, b) => {
      return (
        (a.original as unknown as FormattedOnlineOrder).amountValue -
        (b.original as unknown as FormattedOnlineOrder).amountValue
      );
    },
  },
  {
    accessorKey: "deliveryMethod",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Delivery" />
    ),
    cell: ({ row }) => {
      const method = row.getValue("deliveryMethod");

      let content = <div>{row.getValue("deliveryMethod")}</div>;

      if (method == "delivery") {
        content = <div>Delivery</div>;
      }

      if (method == "pickup") {
        content = <div>Pickup</div>;
      }

      return (
        <Link
          to="/$orgUrlSlug/store/$storeUrlSlug/orders/$orderSlug"
          params={(prev) => ({
            ...prev,
            orgUrlSlug: prev.orgUrlSlug!,
            storeUrlSlug: prev.storeUrlSlug!,
            orderSlug: row.original._id,
          })}
          search={{ orderStatus: row.original.status, o: getOrigin() }}
        >
          {content}
        </Link>
      );
    },
    enableSorting: false,
    enableHiding: false,
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id));
    },
  },
  {
    accessorKey: "_creationTime",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Placed" />
    ),
    cell: ({ row }) => {
      const s = window.location.pathname.split("/").pop();

      return (
        <Link
          to="/$orgUrlSlug/store/$storeUrlSlug/orders/$orderSlug"
          params={(prev) => ({
            ...prev,
            orgUrlSlug: prev.orgUrlSlug!,
            storeUrlSlug: prev.storeUrlSlug!,
            orderSlug: row.original._id,
          })}
          search={{ orderStatus: s, o: getOrigin() }}
        >
          <p className="text-muted-foreground">
            {getRelativeTime(row.getValue("_creationTime"))}
          </p>
        </Link>
      );
    },
  },
];
