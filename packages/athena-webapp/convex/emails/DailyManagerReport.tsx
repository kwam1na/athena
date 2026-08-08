import type { CSSProperties, ReactNode } from "react";
import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Html,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from "@react-email/components";
import { currencyFormatter } from "../utils";
import { operationalEmailOutlineButton } from "./emailOperationalCtaStyles";

type DailyReportStatus =
  | "applied"
  | "prepared"
  | "skipped"
  | "failed"
  | "dry_run"
  | "disabled"
  | "eligible";

type AttentionTone = "neutral" | "success" | "warning" | "danger";
type DailyReportStatusCopy = {
  label: string;
  preview: string;
  summary: string;
  tone: AttentionTone;
};

export interface DailyManagerReportMetric {
  label: string;
  value: string;
  detail?: string;
  comparison?: string;
  detailComparison?: string;
}

export interface DailyManagerReportItem {
  title: string;
  message: string;
  metrics?: DailyManagerReportMetric[];
  meta?: string;
  tone?: AttentionTone;
}

export interface DailyManagerReportPaymentTotal {
  method: string;
  amount: string;
  amountComparison?: string;
  transactionCount?: number;
  transactionCountComparison?: string;
}

export interface DailyManagerReportSection {
  title: string;
  message: string;
  meta?: string;
}

export interface DailyManagerReportTopItem {
  name: string;
  unitsSold: number;
  detail?: string;
}

export interface DailyManagerReportProps {
  storeName: string;
  operatingDate: string;
  completedAt: string;
  completedBy: string;
  frameVariant?: "bordered" | "unbordered";
  storeCurrency?: string;
  status: DailyReportStatus;
  statusLabel?: string;
  statusSummary?: string;
  reportUrl: string;
  reviewedItems?: DailyManagerReportItem[];
  carryForwardItems?: DailyManagerReportItem[];
  blockers?: DailyManagerReportItem[];
  summaryMetrics?: DailyManagerReportMetric[];
  cashMetrics?: DailyManagerReportMetric[];
  paymentTotals?: DailyManagerReportPaymentTotal[];
  notes?: string;
  presentation?: DailyManagerReportPresentation;
  attentionItems?: DailyManagerReportItem[];
  reportSections?: DailyManagerReportSection[];
  topItems?: DailyManagerReportTopItem[];
  topItemsUrl?: string;
}

export interface DailyManagerReportPresentation {
  previewText?: string;
  eyebrow?: string;
  timestampLabel?: string;
  timestampDate?: string;
  handoffSectionTitle?: string;
  emptyAttentionCopy?: string;
  summarySectionTitle?: string;
  cashSectionTitle?: string;
  paymentSectionTitle?: string;
  notesLabel?: string;
  actionLabel?: string;
  summaryMetricLayout?: "stacked" | "lead";
  topItemsPlacement?: "after-summary" | "after-cash";
}

const previewMoney = formatReportAmount("GHS");

export const dailyManagerReportPreviewProps = {
  blockers: [],
  cashMetrics: sampleCashMetricsFor(previewMoney),
  carryForwardItems: [],
  completedAt: "8:47 PM",
  completedBy: "Athena",
  operatingDate: "Saturday, Aug 8",
  paymentTotals: samplePaymentTotalsFor(previewMoney),
  reportUrl:
    "https://athena.wigclub.store/wigclub/store/wigclub/operations/daily-close?operatingDate=2026-08-08",
  reviewedItems: sampleReviewedItemsFor(previewMoney),
  status: "applied",
  storeCurrency: "GHS",
  storeName: "Wigclub",
  summaryMetrics: sampleSummaryMetricsFor(previewMoney),
  topItems: [
    { name: 'Silk Press 18"', detail: "SP18-NAT", unitsSold: 8 },
    { name: 'Body Wave 20"', detail: "BW20-1B", unitsSold: 6 },
    { name: "HD Lace Closure", detail: "HDLC-14", unitsSold: 4 },
  ],
  topItemsUrl:
    "https://athena.wigclub.store/wigclub/store/wigclub/reports?daysStart=2026-08-08&daysEnd=2026-08-08&daysTableStart=2026-08-08&daysTableEnd=2026-08-08&selectedDay=2026-08-08&units=true",
} satisfies DailyManagerReportProps;

const statusCopy: Record<DailyReportStatus, DailyReportStatusCopy> = {
  applied: {
    label: "Day closed",
    preview: "The operating day is closed.",
    summary: "The day is closed and the report is ready to review.",
    tone: "success",
  },
  prepared: {
    label: "Ready to close",
    preview: "The daily close is ready for review.",
    summary: "Review the remaining details, then complete the close.",
    tone: "warning",
  },
  skipped: {
    label: "Close needs attention",
    preview: "The daily close needs attention.",
    summary:
      "The day is still open. Resolve the remaining items, then complete the close.",
    tone: "warning",
  },
  failed: {
    label: "Close could not be completed",
    preview: "The daily close could not be completed.",
    summary:
      "Athena could not complete the close. Open EOD Review and finish it manually. Contact support if the workflow is unavailable.",
    tone: "danger",
  },
  dry_run: {
    label: "Review complete",
    preview: "Athena checked the daily close without making changes.",
    summary:
      "Athena checked the daily close. No changes were made.",
    tone: "neutral",
  },
  disabled: {
    label: "Automatic close is off",
    preview: "Automatic close is off for this operating day.",
    summary: "Complete the close manually when the day is ready.",
    tone: "neutral",
  },
  eligible: {
    label: "Ready for automatic close",
    preview: "The operating day is ready for automatic close.",
    summary: "Athena can complete the close when the scheduled check runs.",
    tone: "neutral",
  },
};

const unavailableStatusCopy: DailyReportStatusCopy = {
  label: "Report needs review",
  preview: "The daily report needs review.",
  summary: "Open Athena to review this report.",
  tone: "neutral",
};

export default function DailyManagerReport({
  storeName,
  operatingDate,
  completedAt,
  completedBy,
  frameVariant = "unbordered",
  storeCurrency = "GHS",
  status,
  statusLabel,
  statusSummary,
  reportUrl,
  reviewedItems = [],
  carryForwardItems = [],
  blockers = [],
  summaryMetrics = [],
  cashMetrics = [],
  paymentTotals = [],
  notes,
  presentation,
  attentionItems: suppliedAttentionItems,
  reportSections = [],
  topItems = [],
  topItemsUrl,
}: DailyManagerReportProps) {
  const copy = statusCopy[status] ?? unavailableStatusCopy;
  const resolvedStatusLabel = statusLabel ?? copy.label;
  const resolvedStatusSummary = statusSummary ?? copy.summary;
  const previewText =
    presentation?.previewText ??
    `${storeName ?? "Athena"} EOD: ${resolvedStatusLabel}. ${copy.preview}`;
  const timestampLabel =
    presentation?.timestampLabel ??
    (status === "applied"
      ? "Closed"
      : status === "prepared"
        ? "Prepared"
        : "Updated");
  const attentionItems =
    suppliedAttentionItems ??
    buildAttentionItems({ blockers, carryForwardItems });
  const actionRequired = status === "skipped" || status === "failed";
  const hasRegisterSessionBlocker = blockers.some(isRegisterSessionBlocker);
  const expectedCashMetrics = cashMetrics.filter((metric) =>
    /expected cash/i.test(metric.label),
  );
  const handoffSectionTitle =
    presentation?.handoffSectionTitle ??
    (actionRequired
      ? "Required action"
      : status === "prepared"
        ? "Manager review"
        : blockers.length > 0
          ? "Before close"
          : "Next opening");
  const emptyAttentionCopy =
    presentation?.emptyAttentionCopy ??
    (actionRequired
      ? "Open EOD Review and complete the close manually."
      : status === "prepared"
        ? "Review EOD Review before completing the store day."
        : "No follow-up needed for this operating day.");
  const attentionSummary = buildAttentionSummary({
    blockers: blockers.length,
    carryForward: carryForwardItems.length,
    reviewed: reviewedItems.length,
    status,
  });
  const showStatusBadge = actionRequired || blockers.length > 0;

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={styles.body}>
        <Container
          style={
            frameVariant === "unbordered"
              ? styles.unborderedShell
              : styles.shell
          }
        >
          <Section style={styles.header}>
            <Text style={styles.eyebrow}>
              {presentation?.eyebrow ??
                (actionRequired ? "Athena EOD alert" : "Athena daily report")}
            </Text>
            <Text style={styles.title}>{storeName}</Text>
            <Text style={styles.subtitle}>
              {operatingDate} | {timestampLabel}
              {presentation?.timestampDate
                ? ` ${presentation.timestampDate}`
                : ""}{" "}
              at {completedAt} by{" "}
              {completedBy}
            </Text>
          </Section>

          <Section style={statusPanelStyleFor(copy.tone)}>
            <Row>
              <Column style={styles.statusColumn}>
                <Text style={styles.statusTitleStandalone}>
                  {resolvedStatusLabel}
                </Text>
                {resolvedStatusSummary ? (
                  <Text style={styles.statusSummary}>
                    {resolvedStatusSummary}
                  </Text>
                ) : null}
              </Column>
              {showStatusBadge && (
                <Column style={styles.badgeColumn}>
                  <StatusBadge tone={copy.tone}>{attentionSummary}</StatusBadge>
                </Column>
              )}
            </Row>
          </Section>

          <Section style={styles.section}>
            <SectionHeading title={handoffSectionTitle} quietTitle />
            {attentionItems.length === 0 ? (
              <EmptyState>{emptyAttentionCopy}</EmptyState>
            ) : (
              <Section style={styles.attentionList}>
                {attentionItems.slice(0, 4).map((item) => (
                  <AttentionItem
                    key={`${item.title}-${item.message}`}
                    item={item}
                  />
                ))}
              </Section>
            )}
            {attentionItems.length > 4 && (
              <Text style={styles.mutedLine}>
                {attentionItems.length - 4} more item
                {attentionItems.length - 4 === 1 ? "" : "s"} available in
                Athena.
              </Text>
            )}
          </Section>

          <Section style={styles.separatedSection}>
            <SectionHeading
              title={presentation?.summarySectionTitle ?? "Operating summary"}
              quietTitle
            />
            <OperatingSummaryGrid
              layout={presentation?.summaryMetricLayout}
              metrics={summaryMetrics}
            />
          </Section>

          {presentation?.topItemsPlacement !== "after-cash" ? (
            <TopItemsSection items={topItems} url={topItemsUrl} />
          ) : null}

          <Section style={styles.separatedSection}>
            <SectionHeading
              title={presentation?.cashSectionTitle ?? "Cash position"}
              quietTitle
            />
            {hasRegisterSessionBlocker ? (
              <>
                {expectedCashMetrics.length > 0 ? (
                  <SummaryMetricGrid metrics={expectedCashMetrics} />
                ) : null}
                <EmptyState>
                  Final cash count and variance will be available after the
                  register is closed.
                </EmptyState>
              </>
            ) : (
              <SummaryMetricGrid metrics={cashMetrics} />
            )}
          </Section>

          {presentation?.topItemsPlacement === "after-cash" ? (
            <TopItemsSection items={topItems} url={topItemsUrl} />
          ) : null}

          {paymentTotals.length > 0 && (
            <Section style={styles.separatedSection}>
              <SectionHeading
                title={presentation?.paymentSectionTitle ?? "Payment mix"}
                quietTitle
              />
              <PaymentTotalsGrid payments={paymentTotals} />
            </Section>
          )}

          {reportSections.map((section) => (
            <Section key={section.title} style={styles.separatedSection}>
              <SectionHeading title={section.title} quietTitle />
              <Text style={styles.reportSectionMessage}>{section.message}</Text>
              {section.meta ? (
                <Text style={styles.reportSectionMeta}>{section.meta}</Text>
              ) : null}
            </Section>
          ))}

          {notes && (
            <Section style={styles.noteSection}>
              <Text style={styles.noteLabel}>
                {presentation?.notesLabel ?? "Close notes"}
              </Text>
              <Text style={styles.noteText}>{notes}</Text>
            </Section>
          )}

          <Section style={styles.actionSection}>
            <Button
              href={reportUrl}
              style={actionRequired ? styles.buttonPrimary : styles.button}
            >
              <span style={styles.buttonLabel}>
                {presentation?.actionLabel ??
                  (actionRequired ? "Open EOD Review" : "View EOD Review")}
              </span>
              <span aria-hidden="true" style={styles.buttonIcon}>
                ↗
              </span>
            </Button>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

function buildAttentionSummary(args: {
  blockers: number;
  carryForward: number;
  reviewed: number;
  status: DailyReportStatus;
}) {
  if (args.status === "applied") return "No action";
  if (args.blockers > 0) {
    return `${args.blockers} blocker${args.blockers === 1 ? "" : "s"}`;
  }
  if (args.carryForward > 0) {
    return `${args.carryForward} carry-forward`;
  }
  if (args.reviewed > 0) {
    return `${args.reviewed} reviewed`;
  }
  if (args.status === "skipped" || args.status === "failed") {
    return "Action required";
  }
  return "Status update";
}

function buildAttentionItems({
  blockers,
  carryForwardItems,
}: {
  blockers: DailyManagerReportItem[];
  carryForwardItems: DailyManagerReportItem[];
}) {
  const visibleBlockers = blockers.map((item) => ({
    ...item,
    meta: item.meta ?? "Resolve before completing EOD Review.",
  }));
  const carryForwardMessage = carryForwardItems.length
    ? `${carryForwardItems.length} item${
        carryForwardItems.length === 1 ? "" : "s"
      } for the next opening`
    : undefined;
  const carryForwardMeta = carryForwardItems.length
    ? "Review before the next store day starts."
    : undefined;
  const visibleCarryForwardItems = carryForwardItems.length
    ? [
        {
          title: "Opening handoff",
          message: carryForwardMessage ?? "Items for the next opening.",
          meta: carryForwardMeta,
          tone: "warning" as AttentionTone,
        },
      ]
    : [];

  return [...visibleBlockers, ...visibleCarryForwardItems];
}

function isRegisterSessionBlocker(item: DailyManagerReportItem) {
  return /register/i.test(`${item.title} ${item.message}`);
}

function formatReportAmount(currency: string) {
  const formatter = currencyFormatter(currency || "GHS");
  return (amount: number) => formatter.format(amount);
}

function sampleReviewedItemsFor(
  money: (amount: number) => string,
): DailyManagerReportItem[] {
  return [
    {
      title: "Cash variance",
      message: `Expected ${money(1244)} | Counted ${money(1201.82)} | Short ${money(42.18)}`,
      metrics: [
        { label: "Expected", value: money(1244) },
        { label: "Counted", value: money(1201.82) },
        { label: "Short", value: money(42.18) },
      ],
      meta: "Reviewed during close",
      tone: "warning",
    },
    {
      title: "Voided sale",
      message: `TXN-1048 | ${money(220)}`,
      meta: "Reviewed by manager",
      tone: "neutral",
    },
  ];
}

function sampleSummaryMetricsFor(
  money: (amount: number) => string,
): DailyManagerReportMetric[] {
  return [
    { label: "Net sales", value: money(1935) },
    { label: "Units sold", value: "23" },
    { label: "Transactions", value: "5" },
  ];
}

function sampleCashMetricsFor(
  money: (amount: number) => string,
): DailyManagerReportMetric[] {
  return [
    { label: "Expected cash", value: money(615) },
    { label: "Counted cash", value: money(573) },
    { label: "Net variance", value: money(-42) },
  ];
}

function samplePaymentTotalsFor(
  money: (amount: number) => string,
): DailyManagerReportPaymentTotal[] {
  return [
    { method: "Cash", amount: money(615), transactionCount: 2 },
    { method: "Card", amount: money(820), transactionCount: 2 },
    { method: "Mobile money", amount: money(500), transactionCount: 1 },
  ];
}

function SectionHeading({
  detail,
  quietTitle = false,
  title,
}: {
  detail?: string;
  quietTitle?: boolean;
  title: string;
}) {
  return (
    <Row style={styles.sectionHeading}>
      <Column>
        <Text
          style={quietTitle ? styles.sectionTitleQuiet : styles.sectionTitle}
        >
          {title}
        </Text>
      </Column>
      {detail && (
        <Column style={styles.sectionDetailColumn}>
          <Text style={styles.sectionDetail}>{detail}</Text>
        </Column>
      )}
    </Row>
  );
}

function StatusBadge({
  children,
  tone,
}: {
  children: ReactNode;
  tone: AttentionTone;
}) {
  return (
    <Text style={{ ...styles.statusIndicator, color: toneColors[tone] }}>
      {children}
    </Text>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <Text style={styles.emptyState}>{children}</Text>;
}

function AttentionItem({ item }: { item: DailyManagerReportItem }) {
  const hasMetrics = Boolean(item.metrics?.length);

  return (
    <Section style={styles.attentionItem}>
      <Row>
        <Column>
          <Text style={styles.itemTitle}>{item.title}</Text>
          {item.meta ? <Text style={styles.itemMeta}>{item.meta}</Text> : null}
          {hasMetrics ? (
            <AttentionMetricGrid metrics={item.metrics ?? []} />
          ) : (
            <Text style={styles.itemMessage}>{item.message}</Text>
          )}
        </Column>
      </Row>
    </Section>
  );
}

function AttentionMetricGrid({
  metrics,
}: {
  metrics: DailyManagerReportMetric[];
}) {
  return (
    <Section style={styles.attentionMetricGrid}>
      <Row>
        {metrics.slice(0, 3).map((metric) => (
          <Column key={metric.label} style={styles.attentionMetricColumn}>
            <Text style={styles.attentionMetricLabel}>{metric.label}</Text>
            <Text style={styles.attentionMetricValue}>{metric.value}</Text>
            <MetricComparison comparison={metric.comparison} />
          </Column>
        ))}
      </Row>
    </Section>
  );
}

function OperatingSummaryGrid({
  layout = "stacked",
  metrics,
}: {
  layout?: "stacked" | "lead";
  metrics: DailyManagerReportMetric[];
}) {
  if (layout === "lead" && metrics.length > 0) {
    const [leadMetric, ...supportingMetrics] = metrics;

    return (
      <Section style={styles.operatingGrid}>
        <OperatingMetric metric={leadMetric} />
        {supportingMetrics.length > 0 ? (
          <SummaryMetricGrid metrics={supportingMetrics} />
        ) : null}
      </Section>
    );
  }

  return (
    <Section style={styles.operatingGrid}>
      {metrics.map((metric) => (
        <OperatingMetric key={metric.label} metric={metric} />
      ))}
    </Section>
  );
}

function TopItemsSection({
  items,
  url,
}: {
  items: DailyManagerReportTopItem[];
  url?: string;
}) {
  if (items.length === 0 || !url) return null;

  return (
    <Section style={styles.separatedSection}>
      <SectionHeading title="Top items by units sold" quietTitle />
      <Section style={styles.topItemsList}>
        {items.slice(0, 3).map((item, index) => (
          <Row key={`${item.name}-${index}`} style={styles.topItemRow}>
            <Column>
              <Text style={styles.topItemName}>{item.name}</Text>
              {item.detail ? (
                <Text style={styles.topItemDetail}>{item.detail}</Text>
              ) : null}
            </Column>
            <Column style={styles.topItemUnitsColumn}>
              <Text style={styles.topItemUnits}>
                {`${item.unitsSold} ${item.unitsSold === 1 ? "unit" : "units"}`}
              </Text>
            </Column>
          </Row>
        ))}
      </Section>
      <Link href={url} style={styles.topItemsLink}>
        View all top movers ↗
      </Link>
    </Section>
  );
}

function OperatingMetric({ metric }: { metric: DailyManagerReportMetric }) {
  return (
    <Section style={styles.operatingMetric}>
      <Text style={styles.operatingLabel}>{metric.label}</Text>
      <Text style={styles.operatingValue}>{metric.value}</Text>
      {metric.detail ? (
        <Text style={styles.operatingDetail}>{metric.detail}</Text>
      ) : null}
      <MetricComparison
        comparison={metric.comparison}
        detailComparison={metric.detailComparison}
        detailLabel={comparisonDetailLabel(metric.detail)}
        primaryLabel={metric.detail ? metric.label.toLowerCase() : undefined}
      />
    </Section>
  );
}

function SummaryMetricGrid({
  metrics,
}: {
  metrics: DailyManagerReportMetric[];
}) {
  const rows: DailyManagerReportMetric[][] = [];

  for (let index = 0; index < metrics.length; index += 2) {
    rows.push(metrics.slice(index, index + 2));
  }

  return (
    <Section style={styles.summaryGrid}>
      {rows.map((row, rowIndex) => (
        <Row key={`summary-row-${rowIndex}`} style={styles.summaryGridRow}>
          {row.map((metric) => (
            <Column key={metric.label} style={styles.summaryGridColumn}>
              <Text style={styles.summaryLabel}>{metric.label}</Text>
              <Text style={summaryValueStyleFor(metric)}>{metric.value}</Text>
              {metric.detail ? (
                <Text style={styles.summaryDetail}>{metric.detail}</Text>
              ) : null}
              <MetricComparison
                comparison={metric.comparison}
                detailComparison={metric.detailComparison}
                detailLabel={comparisonDetailLabel(metric.detail)}
                primaryLabel={
                  metric.detail ? metric.label.toLowerCase() : undefined
                }
              />
            </Column>
          ))}
          {row.length < 2 &&
            Array.from({ length: 2 - row.length }).map((_, index) => (
              <Column
                key={`summary-empty-${rowIndex}-${index}`}
                style={styles.summaryGridColumn}
              />
            ))}
        </Row>
      ))}
    </Section>
  );
}

function summaryValueStyleFor(metric: DailyManagerReportMetric) {
  if (!/variance/i.test(metric.label)) return styles.summaryValue;

  const numericValue = Number(metric.value.replace(/[^0-9.-]/g, ""));
  if (Number.isNaN(numericValue)) return styles.summaryValue;

  if (numericValue < 0) {
    return { ...styles.summaryValue, color: colors.danger };
  }
  if (numericValue > 0) {
    return { ...styles.summaryValue, color: colors.warning };
  }

  return { ...styles.summaryValue, color: colors.success };
}

function PaymentTotalsGrid({
  payments,
}: {
  payments: DailyManagerReportPaymentTotal[];
}) {
  const rows: DailyManagerReportPaymentTotal[][] = [];

  for (let index = 0; index < payments.length; index += 2) {
    rows.push(payments.slice(index, index + 2));
  }

  return (
    <Section style={styles.paymentGrid}>
      {rows.map((row, rowIndex) => (
        <Row key={`payment-row-${rowIndex}`} style={styles.paymentGridRow}>
          {row.map((payment) => (
            <Column key={payment.method} style={styles.paymentGridColumn}>
              <Text style={styles.paymentLabel}>{payment.method}</Text>
              <Text style={styles.paymentAmount}>{payment.amount}</Text>
              <PaymentMeta payment={payment} />
              <MetricComparison
                comparison={payment.amountComparison}
                detailComparison={payment.transactionCountComparison}
                detailLabel="transactions"
                primaryLabel="amount"
              />
            </Column>
          ))}
          {row.length < 2 &&
            Array.from({ length: 2 - row.length }).map((_, index) => (
              <Column
                key={`payment-empty-${rowIndex}-${index}`}
                style={styles.paymentGridColumn}
              />
            ))}
        </Row>
      ))}
    </Section>
  );
}

function PaymentMeta({ payment }: { payment: DailyManagerReportPaymentTotal }) {
  const count =
    typeof payment.transactionCount === "number"
      ? `${payment.transactionCount} transaction${
          payment.transactionCount === 1 ? "" : "s"
        }`
      : "Transactions";

  return <Text style={styles.paymentDetail}>{count}</Text>;
}

function MetricComparison({
  comparison,
  detailComparison,
  detailLabel = "transactions",
  primaryLabel,
}: {
  comparison?: string;
  detailComparison?: string;
  detailLabel?: string;
  primaryLabel?: string;
}) {
  const parts = [
    comparison ? compactComparison(comparison, primaryLabel) : null,
    detailComparison
      ? compactComparison(detailComparison, detailLabel.toLowerCase())
      : null,
  ].filter((part): part is string => Boolean(part));

  if (parts.length === 0) return null;

  const hasStandalonePriorDayCopy = parts.some((part) =>
    /prior day/i.test(part),
  );

  return (
    <Text style={styles.metricComparison}>
      {parts.join("  ·  ")}
      {hasStandalonePriorDayCopy ? "" : " vs prior day"}
    </Text>
  );
}

function compactComparison(comparison: string, label?: string) {
  if (/^no activity on prior day$/i.test(comparison)) {
    return label ? `No ${label} on prior day` : comparison;
  }

  const compact = comparison.replace(/\s+vs prior day$/i, "");
  if (/^in line$/i.test(compact)) {
    return label ? `${capitalize(label)} in line` : compact;
  }

  const direction = /\bhigher\b/i.test(compact)
    ? "↑"
    : /\blower\b/i.test(compact)
      ? "↓"
      : "";
  const percentage = compact.replace(/\s+(higher|lower)$/i, "");
  const labeled = label ? `${percentage} ${label}` : percentage;

  return direction ? `${direction} ${labeled}` : labeled;
}

function comparisonDetailLabel(detail?: string) {
  return detail?.replace(/^\d+\s+/, "").toLowerCase();
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const fontSans =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const fontNumeric =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

const colors = {
  background: "#f6f6f4",
  border: "#e2e3e6",
  danger: "#dc4438",
  dangerSoft: "#fff1ef",
  foreground: "#1b1c1f",
  muted: "#6f737b",
  raised: "#ffffff",
  signal: "#b02a59",
  success: "#347957",
  successSoft: "#eff8f3",
  surface: "#f8f8f6",
  warning: "#b66b00",
  warningSoft: "#fff7e6",
  workflow: "#454fa3",
  workflowSoft: "#f1f3ff",
};

const toneColors: Record<AttentionTone, string> = {
  danger: colors.danger,
  neutral: colors.workflow,
  success: colors.success,
  warning: colors.warning,
};

function statusPanelStyleFor(tone: AttentionTone): CSSProperties {
  return {
    ...styles.statusPanel,
    borderLeft: `3px solid ${toneColors[tone]}`,
  };
}

const styles: Record<string, CSSProperties> = {
  actionSection: {
    padding: "24px 32px 32px",
    textAlign: "right",
  },
  attentionItem: {
    padding: "0 0 20px",
  },
  attentionList: {
    marginTop: "18px",
  },
  attentionMetricColumn: {
    padding: "0 18px 0 0",
    verticalAlign: "top",
    width: "33.333%",
  },
  attentionMetricGrid: {
    marginTop: "12px",
  },
  attentionMetricLabel: {
    color: colors.muted,
    fontSize: "10px",
    fontWeight: 600,
    letterSpacing: "0.04em",
    lineHeight: "15px",
    margin: "0 0 5px",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  },
  attentionMetricValue: {
    color: colors.foreground,
    fontFamily: fontNumeric,
    fontFeatureSettings: "'tnum' 1, 'lnum' 1",
    fontSize: "21px",
    fontVariantNumeric: "tabular-nums",
    fontWeight: 400,
    lineHeight: "26px",
    margin: 0,
    whiteSpace: "nowrap",
  },
  metricComparison: {
    color: colors.muted,
    fontSize: "10.5px",
    lineHeight: "16px",
    margin: "8px 0 0",
  },
  badgeColumn: {
    textAlign: "right",
    verticalAlign: "top",
    width: "152px",
  },
  body: {
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: fontSans,
    margin: 0,
    padding: "36px 0",
  },
  button: {
    ...operationalEmailOutlineButton,
  },
  buttonPrimary: {
    ...operationalEmailOutlineButton,
  },
  buttonIcon: {
    display: "inline-block",
    fontFamily: fontSans,
    fontSize: "14px",
    fontWeight: 700,
    lineHeight: "14px",
    marginLeft: "8px",
    verticalAlign: "1px",
  },
  buttonLabel: {
    verticalAlign: "middle",
  },
  emptyState: {
    borderLeft: `2px solid ${colors.border}`,
    color: colors.muted,
    fontSize: "13px",
    lineHeight: "19px",
    margin: "12px 0 0",
    padding: "1px 0 1px 12px",
  },
  eyebrow: {
    color: colors.muted,
    fontSize: "10px",
    fontWeight: 700,
    letterSpacing: "0.11em",
    lineHeight: "15px",
    margin: "0 0 10px",
    textTransform: "uppercase",
  },
  header: {
    padding: "36px 32px 24px",
  },
  itemMessage: {
    color: colors.foreground,
    fontSize: "13px",
    lineHeight: "20px",
    margin: "7px 0 0",
  },
  itemTitle: {
    color: colors.foreground,
    fontSize: "13px",
    fontWeight: 600,
    lineHeight: "20px",
    margin: 0,
  },
  itemMeta: {
    color: colors.muted,
    fontSize: "12px",
    fontWeight: 400,
    lineHeight: "18px",
    margin: "5px 0 0",
  },
  mutedLine: {
    color: colors.muted,
    fontSize: "13px",
    lineHeight: "20px",
    margin: "8px 0 0",
  },
  noteLabel: {
    color: colors.muted,
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "0.04em",
    lineHeight: "16px",
    margin: 0,
    textTransform: "uppercase",
  },
  noteSection: {
    backgroundColor: colors.surface,
    borderTop: `1px solid ${colors.border}`,
    padding: "24px 32px",
  },
  noteText: {
    color: colors.foreground,
    fontSize: "14px",
    lineHeight: "20px",
    margin: "10px 0 0",
  },
  operatingDetail: {
    color: colors.muted,
    fontSize: "12px",
    lineHeight: "18px",
    margin: "6px 0 0",
    whiteSpace: "nowrap",
  },
  operatingGrid: {
    marginTop: "20px",
  },
  operatingMetric: {
    marginBottom: "42px",
  },
  operatingLabel: {
    color: colors.muted,
    fontSize: "10px",
    fontWeight: 600,
    letterSpacing: "0.06em",
    lineHeight: "15px",
    margin: "0 0 7px",
    textTransform: "uppercase",
  },
  operatingValue: {
    color: colors.foreground,
    fontFamily: fontNumeric,
    fontFeatureSettings: "'tnum' 1, 'lnum' 1",
    fontSize: "44px",
    fontVariantNumeric: "tabular-nums",
    fontWeight: 400,
    letterSpacing: "-0.025em",
    lineHeight: "48px",
    margin: 0,
    whiteSpace: "nowrap",
  },
  paymentAmount: {
    color: colors.foreground,
    fontFamily: fontNumeric,
    fontFeatureSettings: "'tnum' 1, 'lnum' 1",
    fontSize: "30px",
    fontVariantNumeric: "tabular-nums",
    fontWeight: 400,
    letterSpacing: "-0.02em",
    lineHeight: "36px",
    margin: 0,
  },
  reportSectionMessage: {
    color: colors.foreground,
    fontSize: "18px",
    fontWeight: 500,
    letterSpacing: "-0.01em",
    lineHeight: "25px",
    margin: "18px 0 0",
  },
  reportSectionMeta: {
    color: colors.muted,
    fontSize: "13px",
    lineHeight: "19px",
    margin: "7px 0 0",
  },
  paymentDetail: {
    color: colors.muted,
    fontSize: "11px",
    lineHeight: "16px",
    margin: "5px 0 0",
    whiteSpace: "nowrap",
  },
  paymentGrid: {
    marginTop: "16px",
  },
  paymentGridColumn: {
    padding: "0 20px 0 0",
    verticalAlign: "top",
    width: "50%",
  },
  paymentGridRow: {
    marginBottom: "30px",
  },
  paymentLabel: {
    color: colors.muted,
    fontSize: "10px",
    fontWeight: 600,
    letterSpacing: "0.05em",
    lineHeight: "15px",
    margin: "0 0 6px",
    textTransform: "uppercase",
  },
  section: {
    padding: "24px 32px",
  },
  sectionDetail: {
    color: colors.muted,
    fontSize: "12px",
    lineHeight: "18px",
    margin: 0,
  },
  sectionDetailColumn: {
    textAlign: "right",
  },
  sectionHeading: {
    marginBottom: "10px",
  },
  sectionTitle: {
    color: colors.foreground,
    fontSize: "15px",
    fontWeight: 700,
    lineHeight: "21px",
    margin: 0,
  },
  sectionTitleQuiet: {
    color: colors.muted,
    fontSize: "10px",
    fontWeight: 700,
    letterSpacing: "0.08em",
    lineHeight: "15px",
    margin: 0,
    textTransform: "uppercase",
  },
  separatedSection: {
    borderTop: `1px solid ${colors.border}`,
    padding: "28px 32px 24px",
  },
  shell: {
    backgroundColor: colors.raised,
    border: `1px solid ${colors.border}`,
    borderRadius: "8px",
    margin: "0 auto",
    maxWidth: "640px",
    overflow: "hidden",
  },
  unborderedShell: {
    backgroundColor: colors.raised,
    margin: "0 auto",
    maxWidth: "640px",
    overflow: "hidden",
  },
  statusIndicator: {
    fontSize: "10px",
    fontWeight: 700,
    letterSpacing: "0.06em",
    lineHeight: "15px",
    margin: "1px 0 0",
    textAlign: "right",
    textTransform: "uppercase",
  },
  statusColumn: {
    verticalAlign: "top",
  },
  statusPanel: {
    backgroundColor: colors.surface,
    borderBottom: `1px solid ${colors.border}`,
    borderTop: `1px solid ${colors.border}`,
    padding: "20px 32px 21px 29px",
  },
  statusSummary: {
    color: colors.muted,
    fontSize: "13px",
    lineHeight: "19px",
    margin: "6px 0 0",
  },
  statusTitleStandalone: {
    color: colors.foreground,
    fontSize: "20px",
    fontWeight: 600,
    letterSpacing: "-0.01em",
    lineHeight: "26px",
    margin: 0,
  },
  subtitle: {
    color: colors.muted,
    fontSize: "13px",
    lineHeight: "19px",
    margin: "0",
  },
  title: {
    color: colors.foreground,
    fontSize: "32px",
    fontWeight: 600,
    letterSpacing: "-0.025em",
    lineHeight: "37px",
    margin: "0 0 7px",
  },
  topItemDetail: {
    color: colors.muted,
    fontSize: "11px",
    lineHeight: "16px",
    margin: "3px 0 0",
  },
  topItemName: {
    color: colors.foreground,
    fontSize: "13px",
    fontWeight: 600,
    lineHeight: "19px",
    margin: 0,
  },
  topItemRow: {
    borderBottom: `1px solid ${colors.border}`,
    padding: "12px 0",
  },
  topItemUnits: {
    color: colors.foreground,
    fontFamily: fontNumeric,
    fontSize: "13px",
    fontWeight: 600,
    lineHeight: "19px",
    margin: 0,
    whiteSpace: "nowrap",
  },
  topItemUnitsColumn: {
    textAlign: "right",
    verticalAlign: "top",
    width: "92px",
  },
  topItemsLink: {
    color: colors.foreground,
    display: "inline-block",
    fontSize: "12px",
    fontWeight: 600,
    lineHeight: "18px",
    marginTop: "16px",
    textDecoration: "none",
  },
  topItemsList: {
    marginTop: "8px",
  },
  summaryDetail: {
    color: colors.muted,
    fontSize: "11px",
    lineHeight: "16px",
    margin: "5px 0 0",
    whiteSpace: "nowrap",
  },
  summaryGrid: {
    marginTop: "16px",
  },
  summaryGridColumn: {
    padding: "0 20px 0 0",
    verticalAlign: "top",
    width: "50%",
  },
  summaryGridRow: {
    marginBottom: "30px",
  },
  summaryLabel: {
    color: colors.muted,
    fontSize: "10px",
    fontWeight: 600,
    letterSpacing: "0.05em",
    lineHeight: "15px",
    margin: "0 0 6px",
    textTransform: "uppercase",
  },
  summaryValue: {
    color: colors.foreground,
    fontFamily: fontNumeric,
    fontFeatureSettings: "'tnum' 1, 'lnum' 1",
    fontSize: "30px",
    fontVariantNumeric: "tabular-nums",
    fontWeight: 400,
    letterSpacing: "-0.02em",
    lineHeight: "36px",
    margin: 0,
  },
};
