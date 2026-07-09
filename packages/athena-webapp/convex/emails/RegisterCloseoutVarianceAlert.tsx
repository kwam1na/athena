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
  varianceDirection: "over" | "short";
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
  reason,
  notes,
  reviewUrl,
}: RegisterCloseoutVarianceAlertProps) {
  const previewText = `${storeName}: ${registerLabel} closeout submitted with ${variance} variance.`;
  const varianceLabel =
    varianceDirection === "over"
      ? "Cash over"
      : varianceDirection === "short"
        ? "Cash short"
        : "Cash variance";
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

          <Section style={styles.statusPanel}>
            <Row>
              <Column style={styles.statusColumn}>
                <Text style={styles.statusLabel}>Register closeout</Text>
                <Text style={styles.statusTitle}>
                  Submitted with cash variance
                </Text>
                <Text style={styles.statusSummary}>
                  Review the closeout before finalizing this register session.
                </Text>
              </Column>
              <Column style={styles.badgeColumn}>
                <StatusBadge>{varianceLabel}</StatusBadge>
              </Column>
            </Row>
          </Section>

          <Section style={styles.section}>
            <SectionHeading title="Cash position" />
            <SummaryMetricGrid metrics={metrics} />
          </Section>

          {formattedReason ? (
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
            <Button href={reviewUrl} style={styles.button}>
              <span style={styles.buttonLabel}>Review register closeout</span>
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

function SectionHeading({ title }: { title: string }) {
  return (
    <Row style={styles.sectionHeading}>
      <Column>
        <Text style={styles.sectionTitleQuiet}>{title}</Text>
      </Column>
    </Row>
  );
}

function StatusBadge({ children }: { children: ReactNode }) {
  return <Text style={styles.statusIndicator}>{children}</Text>;
}

function SummaryMetricGrid({
  metrics,
}: {
  metrics: RegisterCloseoutVarianceAlertMetric[];
}) {
  return (
    <Section style={styles.summaryGrid}>
      <Row style={styles.summaryGridRow}>
        {metrics.map((metric) => (
          <Column key={metric.label} style={styles.summaryGridColumn}>
            <Text style={summaryValueStyleFor(metric)}>{metric.value}</Text>
            <Text style={styles.summaryDetail}>
              {metric.label}
              {metric.detail ? ` | ${metric.detail}` : ""}
            </Text>
          </Column>
        ))}
      </Row>
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
  background: "#fcfcfb",
  border: "#dde0e5",
  danger: "#dc4438",
  foreground: "#1d2430",
  muted: "#666b73",
  raised: "#ffffff",
  surface: "#f8f8f7",
  warning: "#b66b00",
  workflowSoft: "#f1f3ff",
};

const styles: Record<string, CSSProperties> = {
  actionSection: {
    padding: "28px 28px 34px",
    textAlign: "right",
  },
  badgeColumn: {
    textAlign: "right",
    verticalAlign: "top",
    width: "132px",
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
    borderTop: `1px solid ${colors.border}`,
    padding: "24px 28px 0",
  },
  noteText: {
    color: colors.foreground,
    fontSize: "14px",
    lineHeight: "22px",
    margin: "8px 0 0",
  },
  reasonText: {
    color: colors.foreground,
    fontSize: "14px",
    lineHeight: "22px",
    margin: "10px 0 0",
  },
  section: {
    padding: "24px 28px 24px",
  },
  sectionHeading: {
    margin: 0,
  },
  sectionTitleQuiet: {
    color: colors.foreground,
    fontSize: "14px",
    fontWeight: 700,
    lineHeight: "20px",
    margin: 0,
  },
  separatedSection: {
    borderTop: `1px solid ${colors.border}`,
    padding: "24px 28px 24px",
  },
  statusColumn: {
    verticalAlign: "top",
  },
  statusIndicator: {
    backgroundColor: colors.workflowSoft,
    border: `1px solid ${colors.border}`,
    borderRadius: "999px",
    color: colors.foreground,
    display: "inline-block",
    fontSize: "12px",
    fontWeight: 700,
    lineHeight: "18px",
    margin: 0,
    padding: "5px 10px",
    whiteSpace: "nowrap",
  },
  statusLabel: {
    color: colors.muted,
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "0.04em",
    lineHeight: "16px",
    margin: "0 0 8px",
    textTransform: "uppercase",
  },
  statusPanel: {
    backgroundColor: colors.surface,
    borderTop: `1px solid ${colors.border}`,
    borderBottom: `1px solid ${colors.border}`,
    padding: "22px 28px",
  },
  statusSummary: {
    color: colors.muted,
    fontSize: "14px",
    lineHeight: "21px",
    margin: "8px 0 0",
  },
  statusTitle: {
    color: colors.foreground,
    fontSize: "24px",
    fontWeight: 600,
    lineHeight: "30px",
    margin: 0,
  },
  subtitle: {
    color: colors.muted,
    fontSize: "14px",
    lineHeight: "21px",
    margin: 0,
  },
  summaryDetail: {
    color: colors.muted,
    fontSize: "12px",
    lineHeight: "18px",
    margin: "6px 0 0",
    whiteSpace: "nowrap",
  },
  summaryGrid: {
    marginTop: "16px",
  },
  summaryGridColumn: {
    padding: "0 18px 0 0",
    verticalAlign: "top",
    width: "33.333%",
  },
  summaryGridRow: {
    margin: 0,
  },
  summaryValue: {
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
  title: {
    color: colors.foreground,
    fontSize: "30px",
    fontWeight: 600,
    letterSpacing: "0",
    lineHeight: "36px",
    margin: 0,
  },
  unborderedShell: {
    backgroundColor: colors.raised,
    maxWidth: "620px",
  },
};
