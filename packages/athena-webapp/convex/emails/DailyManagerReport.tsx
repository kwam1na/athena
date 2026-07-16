import type { CSSProperties, ReactNode } from "react";
import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Html,
  Preview,
  Row,
  Section,
  Text,
} from "@react-email/components";
import { ArrowUpRight } from "lucide-react";
import { currencyFormatter } from "../utils";

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
  transactionCount?: number;
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
}

const sampleBlockers: DailyManagerReportItem[] = [
  {
    title: "Register session is still open",
    message: "Front Counter is still open.",
    meta: "Resolve before completing EOD Review.",
    tone: "danger",
  },
];

const previewMoney = formatReportAmount("GHS");

export const dailyManagerReportPreviewProps = {
  blockers: sampleBlockers,
  cashMetrics: sampleCashMetricsFor(previewMoney),
  carryForwardItems: [],
  completedAt: "8:42 PM",
  completedBy: "Athena",
  operatingDate: "Friday, July 3",
  paymentTotals: samplePaymentTotalsFor(previewMoney),
  reportUrl:
    "https://athena.wigclub.store/wigclub/store/wigclub/operations/daily-close",
  reviewedItems: sampleReviewedItemsFor(previewMoney),
  status: "prepared",
  storeCurrency: "GHS",
  storeName: "Wigclub",
  summaryMetrics: sampleSummaryMetricsFor(previewMoney),
} satisfies DailyManagerReportProps;

const statusCopy: Record<DailyReportStatus, DailyReportStatusCopy> = {
  applied: {
    label: "Completed under policy",
    preview: "EOD completion applied.",
    summary: "Athena completed EOD Review under store policy.",
    tone: "success",
  },
  prepared: {
    label: "Ready for manager review",
    preview: "EOD Review is ready for manager review.",
    summary: "",
    tone: "warning",
  },
  skipped: {
    label: "Manager action required",
    preview: "EOD Review needs manager action.",
    summary:
      "Athena did not close this operating day. Open EOD Review, resolve the remaining items, and complete the close.",
    tone: "warning",
  },
  failed: {
    label: "Automation needs attention",
    preview: "EOD automation needs attention.",
    summary:
      "Athena could not complete the automated EOD check. Open EOD Review and complete the close manually. Contact support if the workflow is unavailable.",
    tone: "danger",
  },
  dry_run: {
    label: "Dry run",
    preview: "EOD automation checked the workflow in dry run.",
    summary:
      "Athena checked EOD Review in dry run. No workflow changes were made.",
    tone: "neutral",
  },
  disabled: {
    label: "Automation off",
    preview: "EOD automation is off for this store day.",
    summary: "EOD Review automation is off for this store day.",
    tone: "neutral",
  },
  eligible: {
    label: "Eligible",
    preview: "EOD Review is ready for automation.",
    summary:
      "Athena found EOD Review ready for automation. No workflow changes were made.",
    tone: "neutral",
  },
};

const unavailableStatusCopy: DailyReportStatusCopy = {
  label: "Status unavailable",
  preview: "Daily report status was not included.",
  summary: "Open Athena to review the daily report.",
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
}: DailyManagerReportProps) {
  const copy = statusCopy[status] ?? unavailableStatusCopy;
  const resolvedStatusLabel = statusLabel ?? copy.label;
  const resolvedStatusSummary = statusSummary ?? copy.summary;
  const previewText = `${storeName ?? "Athena"} EOD: ${resolvedStatusLabel}. ${copy.preview}`;
  const timestampLabel =
    status === "applied"
      ? "Closed"
      : status === "prepared"
        ? "Prepared"
        : "Updated";
  const attentionItems = buildAttentionItems({
    blockers,
    carryForwardItems,
  });
  const actionRequired = status === "skipped" || status === "failed";
  const hasRegisterSessionBlocker = blockers.some(isRegisterSessionBlocker);
  const expectedCashMetrics = cashMetrics.filter((metric) =>
    /expected cash/i.test(metric.label),
  );
  const handoffSectionTitle = actionRequired
    ? "Required action"
    : status === "prepared"
      ? "Manager review"
      : blockers.length > 0
        ? "Before close"
        : "Next opening";
  const emptyAttentionCopy = actionRequired
    ? "Open EOD Review and complete the close manually."
    : status === "prepared"
      ? "Review EOD Review before completing the store day."
      : "No follow-up needed for this operating day.";
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
              {actionRequired ? "Athena EOD alert" : "Athena daily report"}
            </Text>
            <Text style={styles.title}>{storeName}</Text>
            <Text style={styles.subtitle}>
              {operatingDate} | {timestampLabel} at {completedAt} by{" "}
              {completedBy}
            </Text>
          </Section>

          <Section style={styles.statusPanel}>
            <Row>
              <Column style={styles.statusColumn}>
                <Text style={styles.statusLabel}>Status</Text>
                <Text style={styles.statusTitle}>{resolvedStatusLabel}</Text>
                {resolvedStatusSummary ? (
                  <Text style={styles.statusSummary}>
                    {resolvedStatusSummary}
                  </Text>
                ) : null}
              </Column>
              {showStatusBadge && (
                <Column style={styles.badgeColumn}>
                  <StatusBadge>{attentionSummary}</StatusBadge>
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
            <SectionHeading title="Operating summary" quietTitle />
            <OperatingSummaryGrid metrics={summaryMetrics} />
          </Section>

          <Section style={styles.separatedSection}>
            <SectionHeading title="Cash position" quietTitle />
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

          {paymentTotals.length > 0 && (
            <Section style={styles.separatedSection}>
              <SectionHeading title="Payment mix" quietTitle />
              <PaymentTotalsGrid payments={paymentTotals} />
            </Section>
          )}

          {notes && (
            <Section style={styles.noteSection}>
              <Text style={styles.noteLabel}>Close notes</Text>
              <Text style={styles.noteText}>{notes}</Text>
            </Section>
          )}

          <Section style={styles.actionSection}>
            <Button href={reportUrl} style={styles.button}>
              <span style={styles.buttonLabel}>
                {actionRequired ? "Open EOD Review" : "View EOD Review"}
              </span>
              <ArrowUpRight
                aria-hidden="true"
                color={colors.foreground}
                size={14}
                strokeWidth={2}
                style={styles.buttonIcon}
              />
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
    { label: "Sales", value: money(12430), detail: "84 transactions" },
    { label: "Expenses", value: money(340), detail: "1 report" },
    { label: "Voids", value: "1" },
  ];
}

function sampleCashMetricsFor(
  money: (amount: number) => string,
): DailyManagerReportMetric[] {
  return [
    { label: "Expected cash", value: money(1244) },
    { label: "Counted cash", value: money(1201.82) },
    { label: "Net variance", value: money(-42.18) },
  ];
}

function samplePaymentTotalsFor(
  money: (amount: number) => string,
): DailyManagerReportPaymentTotal[] {
  return [
    { method: "Cash", amount: money(1201.82), transactionCount: 18 },
    { method: "Card", amount: money(8420), transactionCount: 52 },
    { method: "Mobile money", amount: money(2808.18), transactionCount: 14 },
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

function StatusBadge({ children }: { children: ReactNode }) {
  return <Text style={styles.statusIndicator}>{children}</Text>;
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
            <Text style={styles.attentionMetricValue}>{metric.value}</Text>
            <Text style={styles.attentionMetricLabel}>{metric.label}</Text>
          </Column>
        ))}
      </Row>
    </Section>
  );
}

function OperatingSummaryGrid({
  metrics,
}: {
  metrics: DailyManagerReportMetric[];
}) {
  return (
    <Section style={styles.operatingGrid}>
      {metrics.map((metric) => (
        <Section key={metric.label} style={styles.operatingMetric}>
          <Text style={styles.operatingValue}>{metric.value}</Text>
          <Text style={styles.operatingDetail}>
            {metric.label}
            {metric.detail ? ` | ${metric.detail}` : ""}
          </Text>
        </Section>
      ))}
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
              <Text style={summaryValueStyleFor(metric)}>{metric.value}</Text>
              <Text style={styles.summaryDetail}>
                {metric.label}
                {metric.detail ? ` | ${metric.detail}` : ""}
              </Text>
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
              <Text style={styles.paymentAmount}>{payment.amount}</Text>
              <PaymentMeta payment={payment} />
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
      ? `${payment.transactionCount} ${payment.method} transaction${
          payment.transactionCount === 1 ? "" : "s"
        }`
      : `${payment.method} transactions`;

  return <Text style={styles.paymentDetail}>{count}</Text>;
}

const fontSans =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const fontNumeric =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

const colors = {
  background: "#fcfcfb",
  border: "#dde0e5",
  danger: "#dc4438",
  dangerSoft: "#fff1ef",
  foreground: "#1d2430",
  muted: "#666b73",
  raised: "#ffffff",
  signal: "#b02a59",
  success: "#347957",
  successSoft: "#eff8f3",
  surface: "#f8f8f7",
  warning: "#b66b00",
  warningSoft: "#fff7e6",
  workflow: "#454fa3",
  workflowSoft: "#f1f3ff",
};

const styles: Record<string, CSSProperties> = {
  actionSection: {
    padding: "28px 28px 34px",
    textAlign: "right",
  },
  attentionItem: {
    padding: "0 0 28px",
  },
  attentionList: {
    marginTop: "22px",
  },
  attentionMetricColumn: {
    padding: "0 18px 0 0",
    verticalAlign: "top",
    width: "33.333%",
  },
  attentionMetricGrid: {
    marginTop: "14px",
  },
  attentionMetricLabel: {
    color: colors.muted,
    fontSize: "11px",
    lineHeight: "16px",
    margin: "4px 0 0",
    whiteSpace: "nowrap",
  },
  attentionMetricValue: {
    color: colors.foreground,
    fontFamily: fontNumeric,
    fontFeatureSettings: "'tnum' 1, 'lnum' 1",
    fontSize: "22px",
    fontVariantNumeric: "tabular-nums",
    fontWeight: 300,
    lineHeight: "28px",
    margin: 0,
    whiteSpace: "nowrap",
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
    padding: "28px 0",
  },
  button: {
    backgroundColor: "transparent",
    border: `1px solid ${colors.border}`,
    borderRadius: "4px",
    color: colors.foreground,
    display: "inline-block",
    fontFamily: fontSans,
    fontSize: "14px",
    fontWeight: 600,
    lineHeight: "20px",
    padding: "10px 14px",
    textDecoration: "none",
  },
  buttonIcon: {
    display: "inline-block",
    marginLeft: "8px",
    verticalAlign: "-2px",
  },
  buttonLabel: {
    verticalAlign: "middle",
  },
  emptyState: {
    backgroundColor: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: "6px",
    color: colors.muted,
    fontSize: "14px",
    lineHeight: "20px",
    margin: "10px 0 0",
    padding: "14px 16px",
  },
  eyebrow: {
    color: colors.muted,
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "0.08em",
    lineHeight: "16px",
    margin: "0 0 8px",
    textTransform: "uppercase",
  },
  header: {
    padding: "28px 28px 18px",
  },
  itemMessage: {
    color: colors.foreground,
    fontSize: "14px",
    lineHeight: "21px",
    margin: "9px 0 0",
  },
  itemTitle: {
    color: colors.foreground,
    fontSize: "14px",
    fontWeight: 700,
    lineHeight: "20px",
    margin: 0,
  },
  itemMeta: {
    color: colors.muted,
    fontSize: "12px",
    fontWeight: 400,
    lineHeight: "18px",
    margin: "6px 0 0",
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
    padding: "26px 28px",
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
    margin: "12px 0 0",
    whiteSpace: "nowrap",
  },
  operatingGrid: {
    marginTop: "24px",
  },
  operatingMetric: {
    marginBottom: "72px",
  },
  operatingValue: {
    color: colors.foreground,
    fontFamily: fontNumeric,
    fontFeatureSettings: "'tnum' 1, 'lnum' 1",
    fontSize: "52px",
    fontVariantNumeric: "tabular-nums",
    fontWeight: 300,
    lineHeight: "56px",
    margin: 0,
    whiteSpace: "nowrap",
  },
  paymentAmount: {
    color: colors.foreground,
    fontFamily: fontNumeric,
    fontFeatureSettings: "'tnum' 1, 'lnum' 1",
    fontSize: "36px",
    fontVariantNumeric: "tabular-nums",
    fontWeight: 300,
    lineHeight: "40px",
    margin: 0,
  },
  paymentDetail: {
    color: colors.muted,
    fontSize: "11px",
    lineHeight: "16px",
    margin: "12px 0 0",
    whiteSpace: "nowrap",
  },
  paymentGrid: {
    marginTop: "18px",
  },
  paymentGridColumn: {
    padding: "0 20px 0 0",
    verticalAlign: "top",
    width: "50%",
  },
  paymentGridRow: {
    marginBottom: "40px",
  },
  section: {
    padding: "26px 28px 22px",
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
    marginBottom: "12px",
  },
  sectionTitle: {
    color: colors.foreground,
    fontSize: "15px",
    fontWeight: 750,
    lineHeight: "21px",
    margin: 0,
  },
  sectionTitleQuiet: {
    color: colors.muted,
    fontSize: "12px",
    fontWeight: 500,
    letterSpacing: "0.02em",
    lineHeight: "18px",
    margin: 0,
  },
  separatedSection: {
    borderTop: `1px solid ${colors.border}`,
    padding: "34px 28px 28px",
  },
  shell: {
    backgroundColor: colors.raised,
    border: `1px solid ${colors.border}`,
    borderRadius: "8px",
    margin: "0 auto",
    maxWidth: "620px",
    overflow: "hidden",
  },
  unborderedShell: {
    backgroundColor: colors.raised,
    margin: "0 auto",
    maxWidth: "620px",
    overflow: "hidden",
  },
  statusIndicator: {
    color: colors.foreground,
    fontSize: "12px",
    fontWeight: 500,
    lineHeight: "18px",
    margin: "1px 0 0",
    textAlign: "right",
  },
  statusColumn: {
    verticalAlign: "top",
  },
  statusLabel: {
    color: colors.muted,
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "0.06em",
    lineHeight: "16px",
    margin: 0,
    textTransform: "uppercase",
  },
  statusPanel: {
    backgroundColor: colors.surface,
    borderBottom: `1px solid ${colors.border}`,
    borderTop: `1px solid ${colors.border}`,
    padding: "18px 28px",
  },
  statusSummary: {
    color: colors.muted,
    fontSize: "14px",
    lineHeight: "20px",
    margin: "7px 0 0",
  },
  statusTitle: {
    color: colors.foreground,
    fontSize: "24px",
    fontWeight: 500,
    lineHeight: "30px",
    margin: "5px 0 0",
  },
  subtitle: {
    color: colors.muted,
    fontSize: "14px",
    lineHeight: "20px",
    margin: "0",
  },
  title: {
    color: colors.foreground,
    fontSize: "28px",
    fontWeight: 500,
    lineHeight: "34px",
    margin: "0 0 8px",
  },
  summaryDetail: {
    color: colors.muted,
    fontSize: "11px",
    lineHeight: "16px",
    margin: "12px 0 0",
    whiteSpace: "nowrap",
  },
  summaryGrid: {
    marginTop: "18px",
  },
  summaryGridColumn: {
    padding: "0 20px 0 0",
    verticalAlign: "top",
    width: "50%",
  },
  summaryGridRow: {
    marginBottom: "40px",
  },
  summaryValue: {
    color: colors.foreground,
    fontFamily: fontNumeric,
    fontFeatureSettings: "'tnum' 1, 'lnum' 1",
    fontSize: "36px",
    fontVariantNumeric: "tabular-nums",
    fontWeight: 300,
    lineHeight: "40px",
    margin: 0,
  },
};

const toneStyles: Record<AttentionTone, CSSProperties> = {
  danger: {
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
  },
  neutral: {
    backgroundColor: colors.workflowSoft,
    color: colors.workflow,
  },
  success: {
    backgroundColor: colors.successSoft,
    color: colors.success,
  },
  warning: {
    backgroundColor: colors.warningSoft,
    color: colors.warning,
  },
};
