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
import { toDisplayAmount } from "../lib/currency";
import { currencyFormatter } from "../utils";
import { formatStoredReviewReason } from "../../shared/reviewReasonFormatter";

export interface RegisterCloseoutVarianceAlertMetric {
  label: string;
  value: string;
  detail?: string;
}

export interface RegisterCloseoutVarianceAlertProps {
  storeName: string;
  registerLabel: string;
  operatingDate: string;
  submittedAt: string;
  submittedBy: string;
  expectedCash: string;
  countedCash: string;
  currency?: string;
  variance: string;
  varianceDirection: "matched" | "over" | "short";
  outcome?: "review_required" | "closed";
  reason?: string;
  notes?: string;
  reviewUrl: string;
}

export const registerCloseoutVarianceAlertPreviewProps = {
  countedCash: "GH₵1,201.82",
  currency: "GHS",
  expectedCash: "GH₵1,244.00",
  notes:
    "Cash drawer was counted twice before submission. Operator noted one missing GH₵50 note from the morning float.",
  operatingDate: "Friday, July 3",
  reason: "Variance exceeded the closeout approval threshold.",
  registerLabel: "Front counter / Register 2",
  reviewUrl:
    "https://athena.wigclub.store/wigclub/store/wigclub/cash-controls/registers/register-session-1",
  storeName: "Wigclub",
  submittedAt: "8:42 PM",
  submittedBy: "Ama Mensah",
  variance: "GH₵-42.18",
  varianceDirection: "short",
} satisfies RegisterCloseoutVarianceAlertProps;

export default function RegisterCloseoutVarianceAlert({
  storeName,
  registerLabel,
  operatingDate,
  submittedAt,
  submittedBy,
  expectedCash,
  countedCash,
  currency = "GHS",
  variance,
  varianceDirection,
  outcome = "review_required",
  reason,
  notes,
  reviewUrl,
}: RegisterCloseoutVarianceAlertProps) {
  const isMatched = varianceDirection === "matched";
  const isClosedReport = outcome === "closed" || isMatched;
  const previewText = isMatched
    ? `${storeName}: ${registerLabel} closed with an exact cash match.`
    : isClosedReport
      ? `${storeName}: ${registerLabel} closed with ${variance} variance.`
      : `${storeName}: ${registerLabel} closeout submitted with ${variance} variance.`;
  const varianceLabel = isMatched
    ? "Cash matched"
    : varianceDirection === "over"
      ? "Cash over"
      : varianceDirection === "short"
        ? "Cash short"
        : "Cash variance";
  const varianceColor = isMatched
    ? colors.success
    : varianceDirection === "short"
      ? colors.danger
      : colors.warning;
  const reasonFormatter = currencyFormatter(currency ?? "GHS");
  const formattedReason = formatStoredReviewReason(reason, (amount) =>
    reasonFormatter.format(toDisplayAmount(amount)),
  );
  const metrics: RegisterCloseoutVarianceAlertMetric[] = [
    { label: "Expected cash", value: expectedCash },
    { label: "Counted cash", value: countedCash },
    { label: varianceLabel, value: variance },
  ];

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={styles.body}>
        <Container style={styles.unborderedShell}>
          <Section style={styles.header}>
            <Text style={styles.eyebrow}>Athena cash controls</Text>
            <Text style={styles.title}>{storeName}</Text>
            <Text style={styles.subtitle}>
              {registerLabel} | {operatingDate} | Submitted at {submittedAt} by{" "}
              {submittedBy}
            </Text>
          </Section>

          <Section
            style={{
              ...styles.statusPanel,
              borderLeft: `3px solid ${varianceColor}`,
            }}
          >
            <Row>
              <Column style={styles.statusColumn}>
                <Text style={styles.statusLabel}>Register closeout</Text>
                <Text style={styles.statusTitle}>
                  {isMatched
                    ? "Closed with an exact cash match"
                    : isClosedReport
                      ? "Closed with cash variance"
                      : "Submitted with cash variance"}
                </Text>
                <Text style={styles.statusSummary}>
                  {isMatched
                    ? "Expected and counted cash match. No review is required."
                    : isClosedReport
                      ? "Register is closed. Review the recorded cash variance in Cash Controls."
                      : "Review the closeout before finalizing this register session."}
                </Text>
              </Column>
              <Column style={styles.badgeColumn}>
                <StatusBadge color={varianceColor}>{varianceLabel}</StatusBadge>
              </Column>
            </Row>
          </Section>

          <Section style={styles.section}>
            <SectionHeading title="Cash position" />
            <SummaryMetricGrid metrics={metrics} />
          </Section>

          {!isMatched && formattedReason ? (
            <Section style={styles.separatedSection}>
              <SectionHeading title="Review reason" />
              <Text style={styles.reasonText}>{formattedReason}</Text>
            </Section>
          ) : null}

          {notes ? (
            <Section style={styles.noteSection}>
              <Text style={styles.noteLabel}>Closeout notes</Text>
              <Text style={styles.noteText}>{notes}</Text>
            </Section>
          ) : null}

          <Section style={styles.actionSection}>
            <Button href={reviewUrl} style={styles.buttonPrimary}>
              <span style={styles.buttonLabel}>
                {isMatched
                  ? "View register closeout"
                  : "Review register closeout"}
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

function SectionHeading({ title }: { title: string }) {
  return (
    <Row style={styles.sectionHeading}>
      <Column>
        <Text style={styles.sectionTitleQuiet}>{title}</Text>
      </Column>
    </Row>
  );
}

function StatusBadge({
  children,
  color,
}: {
  children: ReactNode;
  color: string;
}) {
  return <Text style={{ ...styles.statusIndicator, color }}>{children}</Text>;
}

function SummaryMetricGrid({
  metrics,
}: {
  metrics: RegisterCloseoutVarianceAlertMetric[];
}) {
  const rows: RegisterCloseoutVarianceAlertMetric[][] = [];

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
            </Column>
          ))}
          {row.length < 2 ? <Column style={styles.summaryGridColumn} /> : null}
        </Row>
      ))}
    </Section>
  );
}

function summaryValueStyleFor(metric: RegisterCloseoutVarianceAlertMetric) {
  if (!/cash short|cash over|variance/i.test(metric.label)) {
    return styles.summaryValue;
  }

  if (/cash short/i.test(metric.label)) {
    return { ...styles.summaryValue, color: colors.danger };
  }

  return { ...styles.summaryValue, color: colors.warning };
}

const fontSans =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const fontNumeric =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

const colors = {
  background: "#f6f6f4",
  border: "#e2e3e6",
  danger: "#dc4438",
  foreground: "#1b1c1f",
  muted: "#6f737b",
  raised: "#ffffff",
  success: "#2d7d4f",
  surface: "#f8f8f6",
  warning: "#b66b00",
};

const styles: Record<string, CSSProperties> = {
  actionSection: {
    padding: "24px 32px 32px",
    textAlign: "right",
  },
  badgeColumn: {
    textAlign: "right",
    verticalAlign: "top",
    width: "124px",
  },
  body: {
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: fontSans,
    margin: 0,
    padding: "36px 0",
  },
  buttonPrimary: {
    backgroundColor: colors.foreground,
    border: `1px solid ${colors.foreground}`,
    borderRadius: "6px",
    color: colors.raised,
    display: "inline-block",
    fontFamily: fontSans,
    fontSize: "13px",
    fontWeight: 600,
    lineHeight: "20px",
    padding: "10px 14px",
    textDecoration: "none",
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
  noteLabel: {
    color: colors.muted,
    fontSize: "10px",
    fontWeight: 700,
    letterSpacing: "0.08em",
    lineHeight: "15px",
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
    fontSize: "13px",
    lineHeight: "20px",
    margin: "9px 0 0",
  },
  reasonText: {
    color: colors.foreground,
    fontSize: "13px",
    lineHeight: "20px",
    margin: "9px 0 0",
  },
  section: {
    padding: "28px 32px 24px",
  },
  sectionHeading: {
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
    padding: "24px 32px",
  },
  statusColumn: {
    verticalAlign: "top",
  },
  statusIndicator: {
    fontSize: "10px",
    fontWeight: 700,
    letterSpacing: "0.06em",
    lineHeight: "15px",
    margin: "1px 0 0",
    textAlign: "right",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  },
  statusLabel: {
    color: colors.muted,
    fontSize: "10px",
    fontWeight: 700,
    letterSpacing: "0.06em",
    lineHeight: "15px",
    margin: 0,
    textTransform: "uppercase",
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
  statusTitle: {
    color: colors.foreground,
    fontSize: "20px",
    fontWeight: 600,
    letterSpacing: "-0.01em",
    lineHeight: "26px",
    margin: "5px 0 0",
  },
  subtitle: {
    color: colors.muted,
    fontSize: "13px",
    lineHeight: "19px",
    margin: 0,
  },
  summaryDetail: {
    color: colors.muted,
    fontSize: "11px",
    lineHeight: "16px",
    margin: "5px 0 0",
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
    whiteSpace: "nowrap",
  },
  title: {
    color: colors.foreground,
    fontSize: "32px",
    fontWeight: 600,
    letterSpacing: "-0.025em",
    lineHeight: "37px",
    margin: "0 0 7px",
  },
  unborderedShell: {
    backgroundColor: colors.raised,
    margin: "0 auto",
    maxWidth: "640px",
    overflow: "hidden",
  },
};
