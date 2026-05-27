import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { capitalizeWords, cn } from "@/lib/utils";
import { parseDisplayAmountInput } from "@/lib/pos/displayAmounts";
import { Link2, Loader2, PackagePlus, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  isLikelyQuickAddBarcode,
  normalizeQuickAddLookupCode,
} from "./quickAddProductDialogUtils";

export type QuickAddProductVariantInput = {
  lookupCode?: string;
  price: number;
  quantityAvailable: number;
};

export type QuickAddProductSubmitPayload = {
  name: string;
  variants: QuickAddProductVariantInput[];
  usesMultipleVariants: boolean;
};

export type QuickAddExistingSkuOption = {
  productSkuId: string;
  name: string;
  sku: string;
  category?: string;
  barcode?: string;
  variantAttributes?: string[];
};

export type QuickAddAttachBarcodePayload = {
  lookupCode: string;
  productSkuId: string;
};

type QuickAddReferenceVariant = {
  price?: number;
  quantityAvailable?: number;
};

type QuickAddVariantDraft = {
  id: string;
  lookupCode: string;
  price: string;
  quantity: string;
};

type ParsedQuickAddVariant = {
  lookupCode: string;
  price: number;
  quantityAvailable: number;
};

type QuickAddProductDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (
    payload: QuickAddProductSubmitPayload,
  ) => Promise<boolean | void> | boolean | void;
  onAttachBarcode?: (
    payload: QuickAddAttachBarcodePayload,
  ) => Promise<boolean | void> | boolean | void;
  existingSkuOptions?: QuickAddExistingSkuOption[];
  initialName?: string;
  initialLookupCode?: string;
  lockProductName?: boolean;
  referenceVariant?: QuickAddReferenceVariant | null;
  title?: string;
  variantTitle?: string;
  description?: string;
  variantDescription?: string;
  submitLabel?: string;
  multiVariantSubmitLabel?: string;
  submitErrorMessage?: string;
};

const QUICK_ADD_LOOKUP_CODE_MAX_LENGTH = 64;
function validateQuickAddLookupCode(lookupCode: string) {
  const trimmedLookupCode = lookupCode.trim();
  if (!trimmedLookupCode) {
    return null;
  }

  if (trimmedLookupCode.length > QUICK_ADD_LOOKUP_CODE_MAX_LENGTH) {
    return "Lookup code is too long";
  }

  const lookupCodeWithoutSpaces = trimmedLookupCode.replace(/\s+/g, "");
  if (isLikelyQuickAddBarcode(lookupCodeWithoutSpaces)) {
    return null;
  }

  if (/\s/.test(trimmedLookupCode)) {
    return "Lookup code cannot contain spaces";
  }

  return "Lookup code must be a numeric barcode (digits only)";
}

function getExistingSkuMetadata(option: QuickAddExistingSkuOption) {
  return [
    option.sku || "No SKU",
    option.category,
    ...(option.variantAttributes ?? []),
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
}

export function QuickAddProductDialog({
  open,
  onOpenChange,
  onSubmit,
  onAttachBarcode,
  existingSkuOptions = [],
  initialName = "",
  initialLookupCode = "",
  lockProductName = false,
  referenceVariant = null,
  title = "Quick add product",
  variantTitle = "Quick add variant",
  description = "Add the details needed for this sale",
  variantDescription = "Add different variants for this product",
  submitLabel = "Add product",
  multiVariantSubmitLabel = "Add product variants",
  submitErrorMessage = "Could not quick add this product. Try again.",
}: QuickAddProductDialogProps) {
  const [quickAddName, setQuickAddName] = useState("");
  const [quickAddLookupCode, setQuickAddLookupCode] = useState("");
  const [quickAddPrice, setQuickAddPrice] = useState("");
  const [quickAddQuantity, setQuickAddQuantity] = useState("1");
  const [quickAddUsesMultipleVariants, setQuickAddUsesMultipleVariants] =
    useState(false);
  const [quickAddExtraVariants, setQuickAddExtraVariants] = useState<
    QuickAddVariantDraft[]
  >([]);
  const [quickAddError, setQuickAddError] = useState<string | null>(null);
  const [isQuickAddSaving, setIsQuickAddSaving] = useState(false);
  const [isAttachSaving, setIsAttachSaving] = useState(false);
  const [existingSkuQuery, setExistingSkuQuery] = useState("");
  const [selectedExistingSkuId, setSelectedExistingSkuId] = useState<
    string | null
  >(null);
  const nextQuickAddVariantIdRef = useRef(1);

  const resetQuickAddForm = useCallback(() => {
    setQuickAddName(initialName);
    setQuickAddLookupCode(initialLookupCode);
    setQuickAddPrice("");
    setQuickAddQuantity("1");
    setQuickAddUsesMultipleVariants(false);
    setQuickAddExtraVariants([]);
    setQuickAddError(null);
    setExistingSkuQuery("");
    setSelectedExistingSkuId(null);
  }, [initialLookupCode, initialName]);

  useEffect(() => {
    if (open) {
      resetQuickAddForm();
    }
  }, [open, resetQuickAddForm]);

  const createQuickAddVariantDraft = useCallback((): QuickAddVariantDraft => {
    const variantId = nextQuickAddVariantIdRef.current;
    nextQuickAddVariantIdRef.current += 1;

    return {
      id: `quick-add-variant-${variantId}`,
      lookupCode: "",
      price: "",
      quantity: "1",
    };
  }, []);

  const handleQuickAddMultipleVariantsChange = (checked: boolean) => {
    setQuickAddUsesMultipleVariants(checked);
    if (!checked) {
      setQuickAddExtraVariants([]);
    }
  };

  const updateQuickAddExtraVariant = (
    variantId: string,
    updates: Partial<Omit<QuickAddVariantDraft, "id">>,
  ) => {
    setQuickAddExtraVariants((currentVariants) =>
      currentVariants.map((variant) =>
        variant.id === variantId ? { ...variant, ...updates } : variant,
      ),
    );
  };

  const addQuickAddExtraVariant = () => {
    setQuickAddExtraVariants((currentVariants) => [
      ...currentVariants,
      createQuickAddVariantDraft(),
    ]);
  };

  const removeQuickAddExtraVariant = (variantId: string) => {
    setQuickAddExtraVariants((currentVariants) =>
      currentVariants.filter((variant) => variant.id !== variantId),
    );
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetQuickAddForm();
    }
    onOpenChange(nextOpen);
  };

  const handleCancel = () => {
    resetQuickAddForm();
    onOpenChange(false);
  };

  const handleQuickAddSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (isAttachSaving) {
      return;
    }

    const variantDrafts: QuickAddVariantDraft[] = [
      {
        id: "primary",
        lookupCode: quickAddLookupCode,
        price: quickAddPrice,
        quantity: quickAddQuantity,
      },
      ...(quickAddUsesMultipleVariants ? quickAddExtraVariants : []),
    ];
    const parsedVariants: ParsedQuickAddVariant[] = [];
    const usedLookupCodes = new Set<string>();

    for (const [index, variant] of variantDrafts.entries()) {
      const variantLabel =
        quickAddUsesMultipleVariants && index > 0
          ? `Variant ${index + 1}`
          : "Variant";
      const normalizedLookupCode = normalizeQuickAddLookupCode(
        variant.lookupCode,
      );
      const lookupCodeValidationError = validateQuickAddLookupCode(
        normalizedLookupCode,
      );

      if (lookupCodeValidationError) {
        setQuickAddError(`${variantLabel}: ${lookupCodeValidationError}`);
        return;
      }

      if (normalizedLookupCode) {
        if (usedLookupCodes.has(normalizedLookupCode)) {
          setQuickAddError(`${variantLabel}: Barcode is already listed`);
          return;
        }
        usedLookupCodes.add(normalizedLookupCode);
      }

      const parsedPrice = parseDisplayAmountInput(variant.price);
      if (parsedPrice === undefined || parsedPrice <= 0) {
        setQuickAddError(
          `${variantLabel}: Enter a selling price greater than 0`,
        );
        return;
      }

      const parsedQuantity = variant.quantity.trim() ? +variant.quantity : 0;
      if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
        setQuickAddError(
          `${variantLabel}: Enter a valid quantity greater than 0`,
        );
        return;
      }

      const roundedQuantity = Math.trunc(parsedQuantity);
      const isReferenceVariantAvailable = Boolean(
        referenceVariant && referenceVariant.quantityAvailable !== undefined,
      );
      const isReferencePriceDifferent =
        referenceVariant?.price !== undefined &&
        referenceVariant.price !== parsedPrice;
      const isReferenceQuantityDifferent =
        isReferenceVariantAvailable &&
        referenceVariant?.quantityAvailable !== undefined &&
        Math.trunc(referenceVariant.quantityAvailable) !== roundedQuantity;

      if (
        referenceVariant &&
        !isReferencePriceDifferent &&
        !isReferenceQuantityDifferent
      ) {
        setQuickAddError(
          `${variantLabel}: Add a different price or quantity than the selected variant`,
        );
        return;
      }

      parsedVariants.push({
        lookupCode: normalizedLookupCode,
        price: parsedPrice,
        quantityAvailable: roundedQuantity,
      });
    }

    const parsedName = quickAddName.trim();

    if (!parsedName) {
      setQuickAddError("Enter a valid product name");
      return;
    }

    setQuickAddError(null);
    setIsQuickAddSaving(true);

    try {
      const submitResult = await onSubmit({
        name: parsedName,
        variants: parsedVariants.map((variant) => ({
          lookupCode: variant.lookupCode || undefined,
          price: variant.price,
          quantityAvailable: variant.quantityAvailable,
        })),
        usesMultipleVariants: quickAddUsesMultipleVariants,
      });

      if (submitResult === false) {
        return;
      }

      resetQuickAddForm();
      onOpenChange(false);
    } catch (error) {
      console.error("[Product] Quick add product failed", error);
      setQuickAddError(
        error instanceof Error && error.message
          ? error.message
          : submitErrorMessage,
      );
    } finally {
      setIsQuickAddSaving(false);
    }
  };

  const isAddingVariant = lockProductName;
  const isSaving = isQuickAddSaving || isAttachSaving;
  const normalizedAttachLookupCode = normalizeQuickAddLookupCode(
    quickAddLookupCode,
  );
  const normalizedInitialAttachLookupCode =
    normalizeQuickAddLookupCode(initialLookupCode);
  const canAttachBarcode = Boolean(
    onAttachBarcode &&
      normalizedInitialAttachLookupCode &&
      isLikelyQuickAddBarcode(normalizedInitialAttachLookupCode) &&
      normalizedAttachLookupCode &&
      isLikelyQuickAddBarcode(normalizedAttachLookupCode) &&
      !quickAddUsesMultipleVariants &&
      !isAddingVariant,
  );
  const shouldShowBarcodeRecovery = canAttachBarcode && !isAddingVariant;
  const matchingExistingSkus = useMemo(() => {
    const normalizedQuery = existingSkuQuery.trim().toLowerCase();
    const unbarcodedOptions = existingSkuOptions.filter(
      (option) => !option.barcode,
    );

    if (!normalizedQuery) {
      return [];
    }

    return unbarcodedOptions
      .filter((option) =>
        [
          option.name,
          option.sku,
          option.category,
          ...(option.variantAttributes ?? []),
        ]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(normalizedQuery)),
      )
      .slice(0, 6);
  }, [existingSkuOptions, existingSkuQuery]);

  const selectedExistingSku = existingSkuOptions.find(
    (option) => option.productSkuId === selectedExistingSkuId,
  );

  const handleAttachBarcode = async () => {
    if (!onAttachBarcode) {
      return;
    }

    const lookupCodeValidationError = validateQuickAddLookupCode(
      normalizedAttachLookupCode,
    );
    if (lookupCodeValidationError) {
      setQuickAddError(lookupCodeValidationError);
      return;
    }

    if (!selectedExistingSkuId) {
      setQuickAddError("Select a SKU to attach this barcode");
      return;
    }

    setQuickAddError(null);
    setIsAttachSaving(true);

    try {
      const attachResult = await onAttachBarcode({
        lookupCode: normalizedAttachLookupCode,
        productSkuId: selectedExistingSkuId,
      });

      if (attachResult === false) {
        return;
      }

      resetQuickAddForm();
      onOpenChange(false);
    } catch (error) {
      console.error("[Product] Attach barcode failed", error);
      setQuickAddError(
        error instanceof Error && error.message
          ? error.message
          : "Could not attach this barcode. Try again.",
      );
    } finally {
      setIsAttachSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[min(90vh,760px)] flex-col overflow-hidden sm:max-w-2xl">
        <form
          onSubmit={handleQuickAddSubmit}
          className="flex min-h-0 flex-1 flex-col gap-5 overflow-hidden"
        >
          <DialogHeader className="shrink-0">
            <DialogTitle>
              {shouldShowBarcodeRecovery
                ? "Resolve scanned barcode"
                : isAddingVariant
                ? quickAddUsesMultipleVariants
                  ? "Quick add variants"
                  : variantTitle
                : title}
            </DialogTitle>
            <DialogDescription>
              {shouldShowBarcodeRecovery
                ? "Attach it to an existing SKU or create a new product."
                : isAddingVariant
                  ? variantDescription
                  : description}
            </DialogDescription>
          </DialogHeader>

          <div className="scrollbar-hide min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain pr-1">
            <div className="space-y-5">
              {shouldShowBarcodeRecovery && (
                <section className="space-y-3 rounded-md border border-border bg-surface px-3 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Link existing SKU
                      </p>
                    </div>
                    <div className="max-w-full rounded-md border border-border bg-background px-2 py-1 text-[11px]">
                      <span className="mr-1.5 text-muted-foreground">
                        Barcode
                      </span>
                      <span className="font-mono text-foreground break-all">
                        {normalizedAttachLookupCode}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label
                      className="sr-only"
                      htmlFor="quick-add-existing-sku-search"
                    >
                      Search existing SKU
                    </Label>
                    <Input
                      id="quick-add-existing-sku-search"
                      size="sm"
                      value={existingSkuQuery}
                      onChange={(event) => {
                        setExistingSkuQuery(event.target.value);
                        setSelectedExistingSkuId(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          if (selectedExistingSku) {
                            void handleAttachBarcode();
                          }
                        }
                      }}
                      placeholder="Search product or SKU"
                      disabled={isSaving}
                      autoFocus
                    />
                  </div>
                  <div className="max-h-36 space-y-1.5 overflow-y-auto">
                    {existingSkuQuery.trim() && matchingExistingSkus.length ? (
                      matchingExistingSkus.map((option) => {
                        const isSelected =
                          selectedExistingSkuId === option.productSkuId;
                        const metadata = getExistingSkuMetadata(option);

                        return (
                          <button
                            key={option.productSkuId}
                            type="button"
                            className={cn(
                              "flex min-h-11 w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                              isSelected
                                ? "border-primary bg-primary/5"
                                : "border-border bg-background hover:bg-muted/50",
                            )}
                            onClick={() =>
                              setSelectedExistingSkuId(option.productSkuId)
                            }
                            disabled={isSaving}
                            aria-pressed={isSelected}
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-foreground">
                                {capitalizeWords(option.name)}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {metadata.join(" - ")}
                              </span>
                            </span>
                            {isSelected && (
                              <span className="shrink-0 text-xs font-medium text-primary">
                                Selected
                              </span>
                            )}
                          </button>
                        );
                      })
                    ) : existingSkuQuery.trim() ? (
                      <p className="rounded-md border border-dashed border-border px-2.5 py-2 text-xs text-muted-foreground">
                        No matching SKUs.
                      </p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="workflow"
                    size="sm"
                    className="h-9 w-full justify-center"
                    onClick={handleAttachBarcode}
                    disabled={!selectedExistingSku || isSaving}
                  >
                    {isAttachSaving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Link2 className="mr-2 h-4 w-4" />
                    )}
                    Attach barcode
                  </Button>
                </section>
              )}

              {shouldShowBarcodeRecovery && (
                <div className="flex items-center gap-3 pb-2 pt-5">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Create product
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              )}

              <div className="space-y-2.5">
                <Label htmlFor="quick-add-product-name">Product name</Label>
                <Input
                  id="quick-add-product-name"
                  value={quickAddName}
                  onChange={(event) => setQuickAddName(event.target.value)}
                  placeholder="Product name"
                  disabled={lockProductName || isSaving}
                  autoFocus={!shouldShowBarcodeRecovery}
                />
              </div>

              <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-surface px-4 py-3">
                <div className="space-y-0.5">
                  <Label htmlFor="quick-add-multiple-variants">
                    Add multiple variants
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Create extra variant rows under this product.
                  </p>
                </div>
                <Switch
                  id="quick-add-multiple-variants"
                  checked={quickAddUsesMultipleVariants}
                  disabled={isSaving}
                  onCheckedChange={handleQuickAddMultipleVariantsChange}
                />
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3">
              {quickAddUsesMultipleVariants && (
                <div className="flex shrink-0 items-center justify-between gap-3">
                  <p className="text-sm font-medium text-foreground">
                    Variants
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addQuickAddExtraVariant}
                    disabled={isSaving}
                  >
                    <Plus className="h-4 w-4" />
                    Add variant
                  </Button>
                </div>
              )}

              <div
                className={cn(
                  "space-y-3",
                  quickAddUsesMultipleVariants &&
                    "min-h-0 flex-1 overflow-y-auto pr-1",
                )}
              >
                <div
                  className={cn(
                    quickAddUsesMultipleVariants &&
                      "rounded-md border border-border bg-background p-3",
                  )}
                >
                  {quickAddUsesMultipleVariants && (
                    <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Variant 1
                    </p>
                  )}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)]">
                    <div className="space-y-2">
                      <Label htmlFor="quick-add-lookup-code">Barcode</Label>
                      <Input
                        id="quick-add-lookup-code"
                        value={quickAddLookupCode}
                        onChange={(event) =>
                          setQuickAddLookupCode(event.target.value)
                        }
                        placeholder="Optional"
                        disabled={isSaving}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="quick-add-price">Selling price</Label>
                      <Input
                        id="quick-add-price"
                        inputMode="decimal"
                        value={quickAddPrice}
                        onChange={(event) =>
                          setQuickAddPrice(event.target.value)
                        }
                        placeholder="0.00"
                        disabled={isSaving}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="quick-add-quantity">Available qty</Label>
                      <Input
                        id="quick-add-quantity"
                        inputMode="numeric"
                        value={quickAddQuantity}
                        onChange={(event) =>
                          setQuickAddQuantity(event.target.value)
                        }
                        placeholder="1"
                        disabled={isSaving}
                      />
                    </div>
                  </div>
                </div>

                {quickAddUsesMultipleVariants &&
                  quickAddExtraVariants.map((variant, index) => (
                    <div
                      key={variant.id}
                      className="rounded-md border border-border bg-background p-3"
                    >
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Variant {index + 2}
                        </p>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground"
                          onClick={() => removeQuickAddExtraVariant(variant.id)}
                          disabled={isSaving}
                          aria-label={`Remove variant ${index + 2}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)]">
                        <div className="space-y-2">
                          <Label htmlFor={`${variant.id}-lookup-code`}>
                            Barcode
                          </Label>
                          <Input
                            id={`${variant.id}-lookup-code`}
                            value={variant.lookupCode}
                            onChange={(event) =>
                              updateQuickAddExtraVariant(variant.id, {
                                lookupCode: event.target.value,
                              })
                            }
                            placeholder="Optional"
                            disabled={isSaving}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor={`${variant.id}-price`}>
                            Selling price
                          </Label>
                          <Input
                            id={`${variant.id}-price`}
                            inputMode="decimal"
                            value={variant.price}
                            onChange={(event) =>
                              updateQuickAddExtraVariant(variant.id, {
                                price: event.target.value,
                              })
                            }
                            placeholder="0.00"
                            disabled={isSaving}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor={`${variant.id}-quantity`}>
                            Available qty
                          </Label>
                          <Input
                            id={`${variant.id}-quantity`}
                            inputMode="numeric"
                            value={variant.quantity}
                            onChange={(event) =>
                              updateQuickAddExtraVariant(variant.id, {
                                quantity: event.target.value,
                              })
                            }
                            placeholder="1"
                            disabled={isSaving}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            {quickAddError && (
              <div className="shrink-0 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {quickAddError}
              </div>
            )}
          </div>

          <DialogFooter className="shrink-0 border-t border-border pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSaving}
              variant="workflow"
            >
              {isQuickAddSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <PackagePlus className="mr-2 h-4 w-4" />
              )}
              {quickAddUsesMultipleVariants
                ? multiVariantSubmitLabel
                : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
