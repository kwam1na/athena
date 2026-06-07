import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { Columns3, FileJson, Save, UploadCloud } from "lucide-react";
import { toast } from "sonner";

import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import { useProtectedAdminPageState } from "@/hooks/useProtectedAdminPageState";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { useGetTerminal } from "@/hooks/useGetTerminal";
import { useOptionalManagerElevation } from "@/contexts/ManagerElevationContext";
import { runCommand } from "@/lib/errors/runCommand";
import { presentCommandToast } from "@/lib/errors/presentCommandToast";
import { formatStoredCurrencyAmount } from "@/lib/pos/displayAmounts";
import {
  parseInventoryImportContent,
  type InventoryImportRow,
  type InventoryImportParseResult,
} from "@/lib/inventory-import/inventoryImportParser";
import {
  PageLevelHeader,
  PageWorkspace,
  PageWorkspaceGrid,
  PageWorkspaceMain,
  PageWorkspaceRail,
} from "../common/PageLevelHeader";
import { ListPagination } from "../common/ListPagination";
import { ProtectedAdminSignInView } from "../states/signed-out/ProtectedAdminSignInView";
import { EmptyState } from "../states/empty/empty-state";
import View from "../View";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { LoadingButton } from "../ui/loading-button";
import { Textarea } from "../ui/textarea";
import { OperationsSummaryMetric } from "./OperationsSummaryMetric";

const PREVIEW_PAGE_SIZE = 25;

const PREVIEW_COLUMNS = [
  {
    align: "left",
    id: "product",
    label: "Product",
    render: (row: InventoryImportRow) => row.productName,
  },
  {
    align: "left",
    id: "sku",
    label: "SKU",
    render: (row: InventoryImportRow) => row.sku ?? "-",
  },
  {
    align: "left",
    id: "barcode",
    label: "Barcode",
    render: (row: InventoryImportRow) => row.barcode ?? "-",
  },
  {
    align: "left",
    id: "category",
    label: "Category",
    render: (row: InventoryImportRow) =>
      [row.category, row.subcategory].filter(Boolean).join(" / ") || "-",
  },
  {
    align: "right",
    id: "price",
    label: "Price",
    render: (row: InventoryImportRow) =>
      formatStoredCurrencyAmount("GHS", row.price, {
        revealMinorUnits: true,
      }),
  },
  {
    align: "right",
    id: "quantity",
    label: "Qty",
    render: (row: InventoryImportRow) => row.quantity,
  },
] as const;

type PreviewColumnId = (typeof PREVIEW_COLUMNS)[number]["id"];
type PreviewColumnVisibility = Record<PreviewColumnId, boolean>;

const DEFAULT_PREVIEW_COLUMN_VISIBILITY: PreviewColumnVisibility = {
  barcode: true,
  category: false,
  price: true,
  product: true,
  quantity: true,
  sku: false,
};

export function InventoryImportView() {
  const { activeStore } = useGetActiveStore();
  const terminal = useGetTerminal();
  const managerElevation = useOptionalManagerElevation();
  const adminState = useProtectedAdminPageState({ surface: "store_day" });
  const saveReviewVersion = useMutation(
    api.inventory.catalogImport.saveInventoryImportReviewVersion,
  );
  const activeManagerElevation = managerElevation?.activeElevation;
  const effectiveTerminalId = terminal?._id ?? activeManagerElevation?.terminalId;
  const hasManagerElevation = Boolean(managerElevation?.activeElevation);
  const canImportInventory =
    adminState.hasFullAdminAccess || (hasManagerElevation && Boolean(effectiveTerminalId));
  const latestReviewVersion = useQuery(
    api.inventory.catalogImport.getLatestInventoryImportReviewVersion,
    activeStore?._id && canImportInventory
      ? {
          storeId: activeStore._id as Id<"store">,
          terminalId: effectiveTerminalId,
        }
      : "skip",
  );
  const [fileName, setFileName] = useState("");
  const [rawContent, setRawContent] = useState("");
  const [notes, setNotes] = useState("");
  const [isSavingReviewVersion, setIsSavingReviewVersion] = useState(false);
  const [lastSavedReviewVersion, setLastSavedReviewVersion] = useState<{
    createdAt: number;
    versionNumber: number;
  } | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [previewColumnVisibility, setPreviewColumnVisibility] =
    useState<PreviewColumnVisibility>(DEFAULT_PREVIEW_COLUMN_VISIBILITY);

  const parseResult = useMemo<InventoryImportParseResult | null>(() => {
    if (!rawContent.trim()) return null;
    return parseInventoryImportContent({ content: rawContent, fileName });
  }, [fileName, rawContent]);

  const importKey = useMemo(() => {
    if (!parseResult || parseResult.rows.length === 0) return "";
    return `inventory-import:${activeStore?._id ?? "store"}:${hashString(rawContent)}`;
  }, [activeStore?._id, parseResult, rawContent]);
  const reviewVersionKey = useMemo(() => {
    if (!rawContent.trim()) return "";
    return `inventory-import-review:${activeStore?._id ?? "store"}:${hashString(rawContent)}`;
  }, [activeStore?._id, rawContent]);

  const previewRowCount = parseResult?.rows.length ?? 0;
  const previewPageCount = Math.max(1, Math.ceil(previewRowCount / PREVIEW_PAGE_SIZE));
  const visiblePreviewPage = Math.min(previewPage, previewPageCount);
  const previewRows =
    parseResult?.rows.slice(
      (visiblePreviewPage - 1) * PREVIEW_PAGE_SIZE,
      visiblePreviewPage * PREVIEW_PAGE_SIZE,
    ) ?? [];
  const visiblePreviewColumns = PREVIEW_COLUMNS.filter(
    (column) => previewColumnVisibility[column.id],
  );
  const hasValidRows =
    Boolean(parseResult) &&
    parseResult!.rows.length > 0 &&
    parseResult!.errors.length === 0 &&
    Boolean(activeStore?._id);
  const hasReviewableContent =
    Boolean(parseResult) && Boolean(rawContent.trim()) && Boolean(activeStore?._id);

  useEffect(() => {
    setPreviewPage(1);
  }, [fileName, rawContent]);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setRawContent(await file.text());
    setLastSavedReviewVersion(null);
  };

  const handleSaveReviewVersion = async () => {
    if (!activeStore?._id || !parseResult || !rawContent.trim()) return;

    setIsSavingReviewVersion(true);
    try {
      const result = await runCommand(() =>
        saveReviewVersion({
          fileName: fileName || undefined,
          importKey: importKey || reviewVersionKey,
          issueCount: parseResult.errors.length,
          notes: notes.trim() || undefined,
          rawContent,
          rowCount: parseResult.rows.length,
          sourceFormat: parseResult.format,
          storeId: activeStore._id as Id<"store">,
          terminalId: effectiveTerminalId,
        })
      );

      if (result.kind === "ok") {
        setLastSavedReviewVersion({
          createdAt: result.data.createdAt,
          versionNumber: result.data.versionNumber,
        });
        toast.success(`Review version ${result.data.versionNumber} saved`);
        return;
      }

      presentCommandToast(result);
    } finally {
      setIsSavingReviewVersion(false);
    }
  };

  const handleLoadLatestReviewVersion = () => {
    if (!latestReviewVersion) return;

    setFileName(
      latestReviewVersion.fileName ||
        `inventory-import-review-v${latestReviewVersion.versionNumber}.${latestReviewVersion.sourceFormat}`,
    );
    setRawContent(latestReviewVersion.rawContent);
    setNotes(latestReviewVersion.notes ?? "");
    setLastSavedReviewVersion({
      createdAt: latestReviewVersion.createdAt,
      versionNumber: latestReviewVersion.versionNumber,
    });
    toast.success(`Review version ${latestReviewVersion.versionNumber} loaded`);
  };

  if (adminState.isLoadingAccess) {
    return (
      <View hideBorder hideHeaderBottomBorder>
        <PageWorkspace className="container mx-auto py-layout-2xl">
          <PageLevelHeader
            eyebrow="Operations"
            title="Inventory import"
            description="Loading protected store access."
            showBackButton
          />
        </PageWorkspace>
      </View>
    );
  }

  if (!adminState.isAuthenticated) {
    return <ProtectedAdminSignInView description="Sign in again before importing inventory." />;
  }

  if (!canImportInventory) {
    return (
      <View hideBorder hideHeaderBottomBorder>
        <PageWorkspace className="container mx-auto py-layout-2xl">
          <PageLevelHeader
            eyebrow="Operations"
            title="Inventory import"
            description="Start manager elevation before importing inventory."
            showBackButton
          />
          <EmptyState
            icon={<UploadCloud className="h-10 w-10" />}
            title="Manager elevation required"
            description="Use the account menu to start manager elevation, then return to this import surface."
          />
        </PageWorkspace>
      </View>
    );
  }

  return (
    <View hideBorder hideHeaderBottomBorder>
      <PageWorkspace className="container mx-auto py-layout-2xl">
        <PageLevelHeader
          eyebrow="Operations"
          title="Inventory import"
          description="Load legacy catalog rows, review validation, and write the baseline into Athena."
          showBackButton
        />

        <PageWorkspaceGrid>
          <PageWorkspaceMain>
            <section className="space-y-4 rounded-md border border-border bg-background p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Source file</h2>
                  <p className="text-sm text-muted-foreground">
                    CSV and JSON exports are accepted.
                  </p>
                </div>
                {parseResult ? (
                  <Badge variant={parseResult.errors.length > 0 ? "destructive" : "secondary"}>
                    {parseResult.format.toUpperCase()}
                  </Badge>
                ) : null}
              </div>

              <div className="space-y-2">
                <div className="space-y-2">
                  <Label htmlFor="inventory-import-file">File</Label>
                  <Input
                    id="inventory-import-file"
                    accept=".csv,.json,application/json,text/csv"
                    type="file"
                    onChange={handleFileChange}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="inventory-import-content">Raw export</Label>
                <Textarea
                  id="inventory-import-content"
                  className="min-h-52 font-mono text-xs"
                  value={rawContent}
                  onChange={(event) => {
                    setFileName(fileName || "manual.csv");
                    setRawContent(event.target.value);
                    setLastSavedReviewVersion(null);
                  }}
                />
              </div>
            </section>

            <section className="space-y-4 rounded-md border border-border bg-background p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Preview</h2>
                  <p className="text-sm text-muted-foreground">
                    {parseResult
                      ? `${parseResult.rows.length} row${parseResult.rows.length === 1 ? "" : "s"} ready`
                      : "No rows loaded"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button className="h-8" size="sm" variant="outline">
                        <Columns3 className="mr-2 h-4 w-4" />
                        Columns
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[170px]">
                      <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {PREVIEW_COLUMNS.map((column) => (
                        <DropdownMenuCheckboxItem
                          checked={previewColumnVisibility[column.id]}
                          key={column.id}
                          onCheckedChange={(checked) =>
                            setPreviewColumnVisibility((current) => ({
                              ...current,
                              [column.id]: Boolean(checked),
                            }))
                          }
                        >
                          {column.label}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {parseResult?.errors.length ? (
                    <Badge variant="destructive">{parseResult.errors.length} issue</Badge>
                  ) : null}
                </div>
              </div>

              {parseResult?.errors.length ? (
                <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                  {parseResult.errors.slice(0, 12).map((error) => (
                    <p className="text-sm text-destructive" key={error}>
                      {error}
                    </p>
                  ))}
                </div>
              ) : null}

              {previewRows.length > 0 ? (
                <div className="overflow-hidden rounded-md border border-border">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-left text-sm">
                      <thead className="border-b bg-surface text-xs uppercase text-muted-foreground">
                        <tr>
                          {visiblePreviewColumns.map((column, index) => (
                            <th
                              className={[
                                "py-2 pr-3",
                                index === 0 ? "pl-3" : "",
                                column.align === "right" ? "text-right" : "",
                              ].filter(Boolean).join(" ")}
                              key={column.id}
                            >
                              {column.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {previewRows.map((row) => (
                          <tr key={`${row.rowNumber}-${row.sku ?? row.barcode}`}>
                            {visiblePreviewColumns.map((column, index) => (
                              <td
                                className={[
                                  "py-3 pr-3",
                                  index === 0 ? "pl-3 font-medium" : "",
                                  column.align === "right" ? "text-right" : "",
                                ].filter(Boolean).join(" ")}
                                key={column.id}
                              >
                                {column.render(row)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <ListPagination
                    page={visiblePreviewPage}
                    pageCount={previewPageCount}
                    pageSize={PREVIEW_PAGE_SIZE}
                    totalItems={previewRowCount}
                    onPageChange={setPreviewPage}
                  />
                </div>
              ) : rawContent.trim() ? null : (
                <EmptyState
                  icon={<FileJson className="h-10 w-10" />}
                  title="No import rows"
                  description="Choose a file or paste an export."
                />
              )}
            </section>
          </PageWorkspaceMain>

          <PageWorkspaceRail>
            <aside className="rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface">
              <div className="flex items-start justify-between gap-layout-md">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    Import status
                  </p>
                  <h2 className="mt-1 text-lg font-semibold">Review import</h2>
                </div>
                <Badge variant={parseResult?.errors.length ? "destructive" : "secondary"}>
                  {hasValidRows ? "Ready" : "Review"}
                </Badge>
              </div>
              <p className="mt-layout-sm text-sm leading-6 text-muted-foreground">
                Save the current export as a server review version before using the
                dedicated import workflow.
              </p>

              <div className="mt-layout-md space-y-layout-sm">
                {hasManagerElevation && !adminState.hasFullAdminAccess ? (
                  <Badge variant="secondary">
                    Elevated as {activeManagerElevation?.displayName}
                  </Badge>
                ) : null}
                <div className="grid grid-cols-2 gap-layout-sm">
                  <OperationsSummaryMetric
                    label="Rows"
                    tone="quiet"
                    value={parseResult?.rows.length ?? 0}
                  />
                  <OperationsSummaryMetric
                    label="Issues"
                    tone="quiet"
                    value={parseResult?.errors.length ?? 0}
                  />
                  <OperationsSummaryMetric
                    label="Format"
                    tone="quiet"
                    value={parseResult ? parseResult.format.toUpperCase() : "-"}
                  />
                  <OperationsSummaryMetric
                    label="Store"
                    tone="quiet"
                    value={activeStore?.name ?? "-"}
                  />
                </div>
              </div>

              <div className="mt-layout-md space-y-layout-sm">
                <Label htmlFor="inventory-import-notes">Notes</Label>
                <Textarea
                  id="inventory-import-notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </div>

              <LoadingButton
                className="mt-layout-sm w-full"
                disabled={!hasReviewableContent || isSavingReviewVersion}
                isLoading={isSavingReviewVersion}
                onClick={handleSaveReviewVersion}
                variant="outline"
              >
                <Save className="mr-2 h-4 w-4" />
                Save review version
              </LoadingButton>

              <div className="mt-layout-md border-t border-border pt-layout-md">
                <p className="text-sm font-medium">Saved review version</p>
                {latestReviewVersion ? (
                  <div className="mt-layout-sm space-y-layout-sm">
                    <p className="text-sm leading-6 text-muted-foreground">
                      Version {latestReviewVersion.versionNumber} -{" "}
                      {latestReviewVersion.rowCount} row
                      {latestReviewVersion.rowCount === 1 ? "" : "s"} -{" "}
                      {latestReviewVersion.issueCount} issue
                      {latestReviewVersion.issueCount === 1 ? "" : "s"} -{" "}
                      {formatReviewVersionTime(latestReviewVersion.createdAt)}
                    </p>
                    <Button
                      className="w-full"
                      onClick={handleLoadLatestReviewVersion}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Load saved version
                    </Button>
                  </div>
                ) : (
                  <p className="mt-layout-xs text-sm leading-6 text-muted-foreground">
                    Save the current export to keep a server copy for review.
                  </p>
                )}
                {lastSavedReviewVersion ? (
                  <p className="mt-layout-sm text-xs text-muted-foreground">
                    Last saved: version {lastSavedReviewVersion.versionNumber} -{" "}
                    {formatReviewVersionTime(lastSavedReviewVersion.createdAt)}
                  </p>
                ) : null}
              </div>
            </aside>

          </PageWorkspaceRail>
        </PageWorkspaceGrid>
      </PageWorkspace>
    </View>
  );
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function formatReviewVersionTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}
