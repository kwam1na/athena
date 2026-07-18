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
import { toOperatorMessage } from "@/lib/errors/operatorMessages";
import { capitalizeWords, cn } from "@/lib/utils";
import { parseDisplayAmountInput } from "@/lib/pos/displayAmounts";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import {
  matchesSkuSearchTerms,
  normalizeSkuSearchQuery,
} from "@/lib/stockOps/skuSearch";
import type { ProductSkuSearchResultLike } from "@/lib/skuSearch/productSkuSearchAdapters";
import { useQuery } from "convex/react";
import {
  BrowserMultiFormatReader,
  type IScannerControls,
} from "@zxing/browser";
import {
  Link2,
  Loader2,
  PackagePlus,
  Plus,
  ScanBarcode,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  priceLabel?: string;
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
  skuSearchResults?: ProductSkuSearchResultLike[];
  isSkuSearchLoading?: boolean;
  skuSearchStoreId?: Id<"store">;
  initialName?: string;
  initialLookupCode?: string;
  lockProductName?: boolean;
  referenceVariant?: QuickAddReferenceVariant | null;
  title?: string;
  variantTitle?: string;
  description?: string;
  variantDescription?: string;
  quantityLabel?: string;
  submitLabel?: string;
  multiVariantSubmitLabel?: string;
  submitErrorMessage?: string;
};

const QUICK_ADD_LOOKUP_CODE_MAX_LENGTH = 64;

function formatQuickAddDialogError(error: unknown, fallback: string) {
  if (!(error instanceof Error) || !error.message) {
    return fallback;
  }

  const serverError = error.message.match(
    /Server Error:\s*([\s\S]*?)(?:\s+at\s+|$)/,
  )?.[1];
  const message = serverError?.trim() || error.message;
  const operatorMessage = toOperatorMessage(message);

  if (/\[CONVEX|Request ID|Server Error:/i.test(operatorMessage)) {
    return fallback;
  }

  return operatorMessage;
}

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
    option.priceLabel,
    option.category,
    ...(option.variantAttributes ?? []),
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
}

function buildQuickAddExistingSkuOptionFromSearchResult(
  result: ProductSkuSearchResultLike,
): QuickAddExistingSkuOption {
  return {
    barcode: result.barcode ?? undefined,
    category: result.categoryName ?? undefined,
    name: result.productName,
    productSkuId: String(result.productSkuId),
    sku: result.sku?.trim() || String(result.productSkuId),
    variantAttributes: [
      result.colorName,
      result.size,
      result.length === null ? undefined : String(result.length),
    ].filter((value): value is string => Boolean(value?.trim())),
  };
}

function QuickAddBarcodeScannerDialog({
  onBarcodeDetected,
  onOpenChange,
  open,
}: {
  onBarcodeDetected: (barcode: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const [scannerState, setScannerState] = useState<
    "starting" | "scanning" | "unsupported" | "blocked" | "error"
  >("starting");

  const stopScanner = useCallback(() => {
    scannerControlsRef.current?.stop();
    scannerControlsRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) {
      stopScanner();
      setScannerState("starting");
      return;
    }

    const videoElement = videoRef.current;
    const hasCamera = Boolean(navigator.mediaDevices?.getUserMedia);

    if (!videoElement || !hasCamera) {
      setScannerState("unsupported");
      return;
    }

    let cancelled = false;
    const reader = new BrowserMultiFormatReader(undefined, {
      delayBetweenScanAttempts: 180,
      tryPlayVideoTimeout: 15000,
    });

    setScannerState("starting");

    void reader
      .decodeFromConstraints(
        {
          audio: false,
          video: { facingMode: { ideal: "environment" } },
        },
        videoElement,
        (result, _error, controls) => {
          if (cancelled) {
            return;
          }

          const decodedValue = result?.getText().trim();

          if (!decodedValue) {
            return;
          }

          controls.stop();
          scannerControlsRef.current = null;
          onBarcodeDetected(decodedValue);
          onOpenChange(false);
        },
      )
      .then((controls) => {
        if (cancelled) {
          controls.stop();
          return;
        }

        scannerControlsRef.current = controls;
        setScannerState("scanning");
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        const errorName =
          error instanceof DOMException ? error.name : undefined;
        setScannerState(
          errorName === "NotAllowedError" || errorName === "SecurityError"
            ? "blocked"
            : "error",
        );
      });

    return () => {
      cancelled = true;
      stopScanner();
    };
  }, [onBarcodeDetected, onOpenChange, open, stopScanner]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  const scannerMessage =
    scannerState === "starting"
      ? "Starting camera..."
      : scannerState === "scanning"
        ? "Scanning barcode..."
        : scannerState === "unsupported"
          ? "Camera barcode scanning is not available in this browser."
          : scannerState === "blocked"
            ? "Camera access is blocked for this site."
            : "Could not read from the camera.";

  return createPortal(
    <div
      aria-modal="true"
      className="pointer-events-auto fixed inset-0 z-[60] overflow-y-auto bg-overlay-scrim/60 p-layout-md sm:flex sm:items-center sm:justify-center"
      role="dialog"
      style={{ pointerEvents: "auto" }}
    >
      <section className="relative mx-auto grid w-full max-w-md gap-4 rounded-lg border border-border bg-background p-6 shadow-lg">
        <button
          aria-label="Close barcode scanner"
          className="absolute right-4 top-4 rounded-sm text-muted-foreground opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          onClick={() => onOpenChange(false)}
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
        <header className="space-y-1.5 pr-8">
          <h2 className="text-lg font-semibold leading-none tracking-tight">
            Scan barcode
          </h2>
          <p className="text-sm text-muted-foreground">
            Use the device camera to fill the product barcode.
          </p>
        </header>
        <div className="space-y-layout-md">
          <div className="relative aspect-[4/3] overflow-hidden rounded-md border border-border bg-muted">
            <video
              aria-label="Barcode camera preview"
              autoPlay
              className="h-full w-full object-cover"
              muted
              playsInline
              ref={videoRef}
            />
            {scannerState === "starting" ? (
              <div className="pointer-events-none absolute inset-x-layout-md bottom-layout-md rounded-md border border-border bg-background/85 px-3 py-2 text-center text-sm text-muted-foreground shadow-sm">
                {scannerMessage}
              </div>
            ) : scannerState === "scanning" ? (
              <div className="pointer-events-none absolute inset-x-layout-xl top-1/2 h-px -translate-y-1/2 bg-primary/80 shadow-[0_0_18px_hsl(var(--primary))]" />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-muted/95 px-layout-md text-center text-sm text-muted-foreground">
                {scannerMessage}
              </div>
            )}
          </div>
          {scannerState === "scanning" ? (
            <p className="text-sm text-muted-foreground">{scannerMessage}</p>
          ) : null}
        </div>
      </section>
    </div>,
    document.body,
  );
}

export function QuickAddProductDialog({
  open,
  onOpenChange,
  onSubmit,
  onAttachBarcode,
  existingSkuOptions = [],
  skuSearchResults,
  isSkuSearchLoading = false,
  skuSearchStoreId,
  initialName = "",
  initialLookupCode = "",
  lockProductName = false,
  referenceVariant = null,
  title = "Quick add product",
  variantTitle = "Quick add variant",
  description = "Add the details needed for this sale",
  variantDescription = "Add different variants for this product",
  quantityLabel = "Available qty",
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
  const [isBarcodeScannerOpen, setIsBarcodeScannerOpen] = useState(false);
  const [existingSkuQuery, setExistingSkuQuery] = useState("");
  const [selectedExistingSkuId, setSelectedExistingSkuId] = useState<
    string | null
  >(null);
  const nextQuickAddVariantIdRef = useRef(1);
  const normalizedExistingSkuQuery = normalizeSkuSearchQuery(existingSkuQuery);
  const liveSkuSearchResults = useQuery(
    api.inventory.skuSearch.searchProductSkus,
    skuSearchStoreId && normalizedExistingSkuQuery
      ? {
          limit: 20,
          query: existingSkuQuery,
          storeId: skuSearchStoreId,
        }
      : "skip",
  ) as { results: ProductSkuSearchResultLike[] } | undefined;

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

  const preventOutsideDismiss = (event: Event) => {
    event.preventDefault();
  };

  const handleBarcodeDetected = useCallback((barcode: string) => {
    setQuickAddLookupCode(normalizeQuickAddLookupCode(barcode));
    setQuickAddError(null);
  }, []);

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
      setQuickAddError(formatQuickAddDialogError(error, submitErrorMessage));
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
  const hasAsyncExistingSkuSearch =
    skuSearchResults !== undefined ||
    isSkuSearchLoading ||
    liveSkuSearchResults !== undefined ||
    (Boolean(skuSearchStoreId) && existingSkuOptions.length === 0);
  const resolvedSkuSearchResults =
    skuSearchResults ?? liveSkuSearchResults?.results ?? [];
  const resolvedSkuSearchLoading =
    isSkuSearchLoading ||
    (Boolean(skuSearchStoreId) &&
      Boolean(normalizedExistingSkuQuery) &&
      liveSkuSearchResults === undefined &&
      existingSkuOptions.length === 0);
  const searchableExistingSkuOptions = useMemo(() => {
    if (!hasAsyncExistingSkuSearch) {
      return existingSkuOptions;
    }

    return resolvedSkuSearchResults.map(
      buildQuickAddExistingSkuOptionFromSearchResult,
    );
  }, [existingSkuOptions, hasAsyncExistingSkuSearch, resolvedSkuSearchResults]);
  const matchingExistingSkus = useMemo(() => {
    const normalizedQuery = normalizeSkuSearchQuery(existingSkuQuery);
    const unbarcodedOptions = searchableExistingSkuOptions.filter(
      (option) => !option.barcode,
    );

    if (!normalizedQuery) {
      return [];
    }

    return unbarcodedOptions
      .filter((option) => {
        return matchesSkuSearchTerms(
          [
            option.name,
            option.sku,
            option.priceLabel,
            option.category,
            ...(option.variantAttributes ?? []),
          ],
          normalizedQuery,
        );
      })
      .slice(0, 6);
  }, [existingSkuQuery, searchableExistingSkuOptions]);

  const selectedExistingSku = searchableExistingSkuOptions.find(
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
        formatQuickAddDialogError(
          error,
          "Could not attach this barcode. Try again.",
        ),
      );
    } finally {
      setIsAttachSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="flex max-h-[min(94vh,900px)] flex-col overflow-hidden sm:max-w-3xl"
        onEscapeKeyDown={(event) => {
          if (isBarcodeScannerOpen) {
            event.preventDefault();
          }
        }}
        onInteractOutside={preventOutsideDismiss}
        onPointerDownOutside={preventOutsideDismiss}
      >
        <form
          onSubmit={handleQuickAddSubmit}
          className="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden"
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

          <div className="scrollbar-hide min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain pr-1">
            <div className="space-y-6">
              {shouldShowBarcodeRecovery && (
                <section className="space-y-4 rounded-md border border-border bg-surface px-4 py-4">
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
                  <div className="max-h-64 space-y-2 overflow-y-auto">
                    {existingSkuQuery.trim() && resolvedSkuSearchLoading ? (
                      <p className="rounded-md border border-dashed border-border px-2.5 py-2 text-xs text-muted-foreground">
                        Searching SKUs...
                      </p>
                    ) : existingSkuQuery.trim() && matchingExistingSkus.length ? (
                      matchingExistingSkus.map((option) => {
                        const isSelected =
                          selectedExistingSkuId === option.productSkuId;
                        const metadata = getExistingSkuMetadata(option);

                        return (
                          <button
                            key={option.productSkuId}
                            type="button"
                            className={cn(
                              "flex min-h-14 w-full items-center justify-between gap-4 rounded-md border px-4 py-3 text-left text-sm transition-colors",
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
                    variant="default"
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
                      <div className="relative">
                        <Input
                          className="pr-10"
                          id="quick-add-lookup-code"
                          value={quickAddLookupCode}
                          onChange={(event) =>
                            setQuickAddLookupCode(event.target.value)
                          }
                          placeholder="Optional"
                          disabled={isSaving}
                        />
                        <Button
                          aria-label="Scan with camera"
                          className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          disabled={isSaving}
                          onClick={() => setIsBarcodeScannerOpen(true)}
                          size="icon"
                          type="button"
                          variant="ghost"
                        >
                          <ScanBarcode className="h-4 w-4" />
                        </Button>
                      </div>
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
                      <Label htmlFor="quick-add-quantity">
                        {quantityLabel}
                      </Label>
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
                            {quantityLabel}
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
              variant="default"
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
      <QuickAddBarcodeScannerDialog
        onBarcodeDetected={handleBarcodeDetected}
        onOpenChange={setIsBarcodeScannerOpen}
        open={isBarcodeScannerOpen}
      />
    </Dialog>
  );
}
