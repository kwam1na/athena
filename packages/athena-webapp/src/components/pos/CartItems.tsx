import { Button } from "@/components/ui/button";
import { CardHeader, CardTitle } from "@/components/ui/card";
import {
  Trash2,
  Plus,
  Minus,
  ShoppingBasket,
  Package,
  Scissors,
} from "lucide-react";
import { CartItem } from "./types";
import { currencyFormatter } from "~/convex/utils";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { capitalizeWords, cn } from "~/src/lib/utils";
import { Id } from "~/convex/_generated/dataModel";
import {
  formatStoredAmount,
  parseDisplayAmountInput,
} from "~/src/lib/pos/displayAmounts";
import type { RegisterServiceLineState } from "@/lib/pos/presentation/register/registerUiState";
import { Input } from "@/components/ui/input";
import { useEffect, useState } from "react";

interface CartItemsProps {
  cartItems: CartItem[];
  serviceItems?: RegisterServiceLineState[];
  onUpdateQuantity?: (
    id: Id<"posSessionItem"> | Id<"expenseSessionItem">,
    newQuantity: number,
  ) => void;
  onRemoveItem?: (id: Id<"posSessionItem"> | Id<"expenseSessionItem">) => void;
  onUpdateServiceAmount?: (lineId: string, amount: number) => void;
  onRemoveService?: (lineId: string) => void;
  clearCart?: () => void;
  readOnly?: boolean;
  density?: "comfortable" | "compact";
  className?: string;
}

function normalizeCartQuantityInput(value: string | number) {
  const parsed =
    typeof value === "number" ? value : Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    return 1;
  }

  return Math.max(1, Math.trunc(parsed));
}

function normalizeCartAttribute(value: string | number | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.toLowerCase() === "null") {
    return undefined;
  }

  return normalized;
}

function formatCartAttributeParts(item: CartItem) {
  const displaySize = normalizeCartAttribute(item.size);
  const displayLength = normalizeCartAttribute(item.length);
  const displayColor = normalizeCartAttribute(item.color);

  return [
    displayLength ? `${displayLength}"` : undefined,
    displaySize,
    displayColor ? capitalizeWords(displayColor) : undefined,
  ].filter(Boolean);
}

function CartItemQuantityControl({
  isCompact,
  item,
  onUpdateQuantity,
}: {
  isCompact: boolean;
  item: CartItem;
  onUpdateQuantity: NonNullable<CartItemsProps["onUpdateQuantity"]>;
}) {
  const [draftQuantity, setDraftQuantity] = useState(String(item.quantity));

  useEffect(() => {
    setDraftQuantity(String(item.quantity));
  }, [item.id, item.quantity]);

  const updateQuantity = (quantity: number) => {
    setDraftQuantity(String(Math.max(1, quantity)));
    if (quantity !== item.quantity) {
      onUpdateQuantity(
        item.id as Id<"posSessionItem"> | Id<"expenseSessionItem">,
        quantity,
      );
    }
  };

  const commitDraftQuantity = () => {
    updateQuantity(normalizeCartQuantityInput(draftQuantity));
  };

  return (
    <div
      className={cn(
        "flex items-center rounded-md border border-border bg-background p-1.5 shadow-sm",
        isCompact ? "gap-2" : "gap-3",
      )}
    >
      <Button
        variant="outline"
        size="icon"
        className={cn(
          "rounded-md",
          isCompact ? "h-11 w-11" : "h-12 w-12",
        )}
        aria-label={`Decrease quantity for ${item.name}`}
        onClick={() =>
          updateQuantity(normalizeCartQuantityInput(draftQuantity) - 1)
        }
      >
        <Minus className="h-4 w-4" />
      </Button>
      <label className="sr-only" htmlFor={`cart-quantity-${item.id}`}>
        Quantity for {item.name}
      </label>
      <Input
        id={`cart-quantity-${item.id}`}
        type="number"
        inputMode="numeric"
        pattern="[0-9]*"
        min={1}
        value={draftQuantity}
        className={cn(
          "px-2 text-center font-numeric font-semibold tabular-nums text-foreground [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          isCompact ? "h-11 w-14 text-base" : "h-12 w-16 text-lg",
        )}
        onBlur={commitDraftQuantity}
        onChange={(event) => setDraftQuantity(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            setDraftQuantity(String(item.quantity));
            event.currentTarget.blur();
          }
        }}
      />
      <Button
        variant="outline"
        size="icon"
        className={cn(
          "rounded-md",
          isCompact ? "h-11 w-11" : "h-12 w-12",
        )}
        aria-label={`Increase quantity for ${item.name}`}
        onClick={() =>
          updateQuantity(normalizeCartQuantityInput(draftQuantity) + 1)
        }
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function CartItems({
  cartItems,
  serviceItems = [],
  onUpdateQuantity,
  onRemoveItem,
  onUpdateServiceAmount,
  onRemoveService,
  clearCart,
  readOnly = false,
  density = "comfortable",
  className,
}: CartItemsProps) {
  const { activeStore } = useGetActiveStore();
  const formatter = currencyFormatter(activeStore?.currency || "GHS");
  const isCompact = density === "compact";

  // Compute total quantity once
  const totalQuantity =
    cartItems.reduce((sum, item) => sum + item.quantity, 0) +
    serviceItems.reduce((sum, item) => sum + item.quantity, 0);
  const totalAmount =
    cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0) +
    serviceItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 bg-gradient-to-br from-gray-50/50 to-gray-100/30",
        isCompact && "min-h-72 basis-0",
        className,
      )}
    >
      {totalQuantity > 0 && (
        <CardHeader
          className={cn(
            "flex shrink-0 flex-row items-center justify-between",
            isCompact && "px-4 py-3",
          )}
        >
          <CardTitle className="flex min-w-0 items-center gap-2 text-sm font-medium">
            <ShoppingBasket className="h-4 w-4 shrink-0" />
            <span className="truncate">
              Items · {totalQuantity} · {formatStoredAmount(formatter, totalAmount)}
            </span>
          </CardTitle>
          {!readOnly && clearCart && (
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "border-none bg-transparent text-red-500 hover:bg-red-50 hover:text-red-500",
                isCompact ? "h-10 px-3" : "p-8",
              )}
              onClick={clearCart}
            >
              <Trash2 className="w-4 h-4" />
              {!isCompact && "Clear all"}
            </Button>
          )}
        </CardHeader>
      )}
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-hidden p-4 pb-6",
          isCompact && "flex-1 pt-0",
        )}
      >
        {cartItems.length === 0 && serviceItems.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center py-8 text-center text-muted-foreground">
            <ShoppingBasket className="w-16 h-16 mx-auto mb-4 opacity-50" />
            <div className="space-y-1">
              <p className="text-sm">No items</p>
              {/* <p className="text-sm">Scan or enter a barcode to add items</p> */}
            </div>
          </div>
        ) : (
          <div
            className={cn(
              "min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 pb-12 scrollbar-hide",
              isCompact && "h-full",
            )}
          >
            {serviceItems.map((item) => {
              const canEditAmount =
                !readOnly &&
                (item.pricingModel === "starting_at" ||
                  item.pricingModel === "quote_after_consultation") &&
                Boolean(onUpdateServiceAmount);
              const amountLabel =
                item.pricingModel === "fixed"
                  ? "Fixed price"
                  : item.pricingModel === "starting_at"
                    ? "Entered amount"
                    : "Quoted amount";
              const lineTotal = item.price * item.quantity;

              return (
                <div
                  key={item.id}
                  className={cn(
                    "border bg-white rounded-lg",
                    isCompact
                      ? "space-y-3 p-3"
                      : "grid grid-cols-12 gap-2 p-8 items-center",
                  )}
                >
                  <div
                    className={cn(
                      "flex items-start gap-4",
                      !isCompact && "col-span-5",
                    )}
                  >
                    <div
                      className={cn(
                        "bg-muted rounded flex items-center justify-center flex-shrink-0",
                        isCompact ? "w-12 h-12" : "w-16 h-16",
                      )}
                    >
                      <Scissors className="h-5 w-5 text-muted-foreground" />
                    </div>

                    <div
                      className={cn(
                        "flex min-w-0 flex-1",
                        isCompact
                          ? "items-start justify-between gap-3"
                          : "block space-y-2",
                      )}
                    >
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="truncate text-sm font-medium leading-tight">
                            {capitalizeWords(item.name)}
                          </h4>
                          <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                            Service
                          </span>
                        </div>
                        <div className="space-y-2">
                          <p className="text-xs capitalize text-muted-foreground">
                            {item.serviceMode.replace(/_/g, " ")} · {amountLabel}
                          </p>
                          {!canEditAmount ? (
                            <p className="text-sm font-medium">
                              {formatStoredAmount(formatter, item.price)}
                            </p>
                          ) : null}
                        </div>
                        {item.amountRequired ? (
                          <p className="text-xs font-medium text-amber-700">
                            Enter an amount before checkout.
                          </p>
                        ) : null}
                      </div>

                      {isCompact && !canEditAmount ? (
                        <p className="shrink-0 text-right text-sm font-semibold">
                          {formatStoredAmount(formatter, lineTotal)}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div
                    className={cn(
                      "flex items-center",
                      isCompact ? "justify-between pt-3" : "contents",
                    )}
                  >
                    {!isCompact ? <div className="col-span-4" /> : null}
                    <div
                      className={cn(
                        "flex items-center",
                        isCompact ? "justify-start" : "col-span-2 justify-end",
                      )}
                    >
                      {canEditAmount ? (
                        <Input
                          aria-label={`${item.name} service amount`}
                          className="h-10 max-w-32 text-right"
                          defaultValue={
                            item.price > 0 ? (item.price / 100).toString() : ""
                          }
                          inputMode="decimal"
                          placeholder="Amount"
                          onBlur={(event) => {
                            const parsedAmount = parseDisplayAmountInput(
                              event.target.value,
                            );
                            if (parsedAmount !== undefined) {
                              onUpdateServiceAmount?.(item.id, parsedAmount);
                            }
                          }}
                        />
                      ) : isCompact ? (
                        null
                      ) : (
                        <div className="text-right">
                          <p className="text-sm font-medium">
                            {formatStoredAmount(formatter, lineTotal)}
                          </p>
                        </div>
                      )}
                    </div>

                    {!readOnly && onRemoveService ? (
                      <div
                        className={cn(
                          "flex justify-center",
                          !isCompact && "col-span-1",
                        )}
                      >
                        <Button
                          variant="ghost"
                          size="default"
                          className={cn(
                            "text-destructive hover:text-destructive hover:bg-destructive/10",
                            isCompact ? "h-10 w-10 p-0" : "h-10 w-10 p-8",
                          )}
                          onClick={() => onRemoveService(item.id)}
                        >
                          <Trash2
                            className={cn(isCompact ? "w-4 h-4" : "w-5 h-5")}
                          />
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}

            {cartItems.map((item) => {
              const attributeParts = formatCartAttributeParts(item);

              return (
              <div
                key={item.id}
                className={cn(
                  "rounded-lg border bg-white",
                  isCompact
                    ? "space-y-3 p-3"
                    : "space-y-4 p-4 sm:grid sm:grid-cols-12 sm:items-center sm:gap-3 sm:space-y-0 sm:p-6 lg:p-8",
                )}
              >
                {/* Product Image & Info Combined */}
                <div
                  className={cn(
                    "flex items-start gap-4",
                    !isCompact && "sm:col-span-7 lg:col-span-5",
                  )}
                >
                  <div className="relative shrink-0">
                    <div
                      className={cn(
                        "flex shrink-0 items-center justify-center rounded bg-muted",
                        isCompact ? "w-12 h-12" : "w-16 h-16",
                      )}
                    >
                      {item.image ? (
                        <img
                          src={item.image}
                          alt={item.name}
                          className="w-full h-full object-cover rounded"
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          <Package className="w-5 h-5" />
                        </span>
                      )}
                    </div>
                    {readOnly && (
                      <div className="absolute -top-2 -left-2 bg-muted text-primary-background text-xs w-5 h-5 rounded-full flex items-center justify-center shadow-sm">
                        {item.quantity}
                      </div>
                    )}
                  </div>

                  <div
                    className={cn(
                      "flex min-w-0 flex-1",
                      isCompact
                        ? "items-start justify-between gap-3"
                        : "items-start justify-between gap-3 sm:block sm:space-y-2",
                    )}
                  >
                    <div className="min-w-0 flex-1 space-y-2">
                      <h4 className="text-sm font-medium leading-5 text-foreground sm:line-clamp-2 sm:leading-tight">
                        {capitalizeWords(item.name)}
                      </h4>

                      <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5">
                        {item.sku && (
                          <p className="break-all text-xs leading-4 text-muted-foreground sm:truncate">
                            {item.sku}
                          </p>
                        )}
                        {item.sku && item.barcode && (
                          <p className="text-xs text-muted-foreground">•</p>
                        )}
                        {item.barcode && (
                          <p className="break-all text-xs leading-4 text-muted-foreground sm:truncate">
                            {item.barcode}
                          </p>
                        )}
                      </div>

                      {attributeParts.length > 0 && (
                        <p className="text-xs text-muted-foreground capitalize">
                          {attributeParts.join(" • ")}
                        </p>
                      )}

                      <p
                        className={cn(
                          "text-sm font-medium text-foreground",
                          !isCompact && "sm:pt-2",
                        )}
                      >
                        {formatStoredAmount(formatter, item.price)}
                      </p>
                    </div>

                    {(isCompact || !readOnly) && (
                      <p className="shrink-0 text-right text-sm font-semibold">
                        {formatStoredAmount(
                          formatter,
                          item.price * item.quantity,
                        )}
                      </p>
                    )}
                  </div>
                </div>

                <div
                  className={cn(
                    "flex items-center",
                    isCompact
                      ? "justify-between pt-3"
                      : "justify-between gap-3 sm:contents",
                  )}
                >
                  {/* Quantity Controls */}
                  <div
                    className={cn(
                      "flex items-center",
                      isCompact
                        ? "justify-start"
                        : "justify-start sm:col-span-3 sm:justify-center lg:col-span-4",
                    )}
                  >
                    {!readOnly && (
                      onUpdateQuantity && (
                        <CartItemQuantityControl
                          isCompact={isCompact}
                          item={item}
                          onUpdateQuantity={onUpdateQuantity}
                        />
                      )
                    )}
                  </div>

                  <div
                    className={cn(
                      "text-right",
                      isCompact && "hidden",
                      !isCompact && "shrink-0 sm:col-span-1 lg:col-span-2",
                      readOnly && !isCompact && "sm:col-span-4 lg:col-span-2",
                    )}
                  >
                    <p className="font-semibold text-sm">
                      {formatStoredAmount(
                        formatter,
                        item.price * item.quantity,
                      )}
                    </p>
                  </div>

                  {!readOnly && onRemoveItem && (
                    <div
                      className={cn(
                        "flex justify-center",
                        !isCompact && "sm:col-span-1",
                      )}
                    >
                      <Button
                        variant="ghost"
                        size="default"
                        aria-label={`Remove ${item.name}`}
                        className={cn(
                          "text-destructive hover:text-destructive hover:bg-destructive/10",
                          isCompact ? "h-10 w-10 p-0" : "h-10 w-10 p-8",
                        )}
                        onClick={() =>
                          onRemoveItem &&
                          onRemoveItem(
                            item.id as
                              | Id<"posSessionItem">
                              | Id<"expenseSessionItem">,
                          )
                        }
                      >
                        <Trash2
                          className={cn(isCompact ? "w-4 h-4" : "w-5 h-5")}
                        />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
