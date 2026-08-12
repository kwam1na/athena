import type { CSSProperties } from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { operationalEmailOutlineButton } from "./emailOperationalCtaStyles";

/**
 * The report verification discrepancy alert (plan U5, requirement R4).
 *
 * The whole point of this template is the SEPARATION the verifier has always
 * made and nothing has ever surfaced: "checked and wrong" is not the same
 * claim as "could not check". `differences` is the alertable residue — fields
 * that were actually compared and disagreed. `notCheckedFields` is
 * verify.ts's `unverifiedFields` (plus anything a truncated scan withheld),
 * rendered in its OWN visually distinct section and never as a difference:
 * silence on a withheld field is not evidence of agreement, and presenting it
 * beside real differences would let a reader infer agreement that was never
 * established.
 *
 * `explainedDifferences` are real differences the classifier attributed to a
 * documented convention or blind spot. They are shown for context, plainly
 * labelled as not requiring action, so the email is a complete account of the
 * run rather than a filtered one.
 */
export interface ReportVerificationAlertDifference {
  /** Human label for the compared field. */
  label: string;
  expected: string;
  actual: string;
  /** Why this difference is not alertable; explained differences only. */
  note?: string;
}

export interface ReportVerificationAlertProps {
  storeName: string;
  /** "Day" or "Week" — drives the copy, not just the heading. */
  subjectKindLabel: string;
  /** Human subject label, e.g. "Saturday, August 8". */
  subjectLabel: string;
  verifiedAtLabel: string;
  /** Consecutive runs this discrepancy has survived. */
  streakCount: number;
  /** Checked and wrong — the alertable residue. */
  differences: ReportVerificationAlertDifference[];
  /** Real differences a documented convention or blind spot accounts for. */
  explainedDifferences: ReportVerificationAlertDifference[];
  /** Could not check — never presented as differences. */
  notCheckedFields: string[];
  reviewUrl: string;
}

export const reportVerificationAlertPreviewProps = {
  differences: [
    {
      actual: "GH₵12,480.00",
      expected: "GH₵12,930.00",
      label: "Net sales",
    },
    {
      actual: "312",
      expected: "318",
      label: "Units sold",
    },
  ],
  explainedDifferences: [
    {
      actual: "4",
      expected: "0",
      label: "Units returned",
      note: "Known blind spot - no independent source to compare against.",
    },
  ],
  notCheckedFields: [
    "Payments refunded",
    "Payment allocation coverage",
    "Payment allocation omitted",
  ],
  reviewUrl: "https://athena-os.app/wigclub/store/wigclub/reports",
  storeName: "Wigclub",
  streakCount: 2,
  subjectKindLabel: "Day",
  subjectLabel: "Saturday, August 8",
  verifiedAtLabel: "Saturday, Aug 8 · Verified at 6:15 AM",
} satisfies ReportVerificationAlertProps;

export function ReportVerificationAlert({
  storeName,
  subjectKindLabel,
  subjectLabel,
  verifiedAtLabel,
  streakCount,
  differences,
  explainedDifferences,
  notCheckedFields,
  reviewUrl,
}: ReportVerificationAlertProps) {
  const hasDifferences = differences.length > 0;
  const previewText = hasDifferences
    ? `${storeName}: reported ${subjectKindLabel.toLowerCase()} totals disagree with source records for ${subjectLabel}.`
    : `${storeName}: ${subjectKindLabel.toLowerCase()} verification could not complete for ${subjectLabel}.`;
  const statusTitle = hasDifferences
    ? "Reported totals disagree with source records"
    : "Verification could not complete";
  const statusSummary = hasDifferences
    ? `Independent verification recomputed this ${subjectKindLabel.toLowerCase()} from the source records and got different numbers than the report shows.` +
      (streakCount > 1
        ? ` This has now been true for ${streakCount} consecutive checks.`
        : "")
    : `Independent verification could not establish this ${subjectKindLabel.toLowerCase()}'s totals. Nothing below is a confirmed difference.`;

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={styles.body}>
        <Container style={styles.shell}>
          <Section style={styles.header}>
            <Text style={styles.eyebrow}>Athena report verification</Text>
            <Text style={styles.title}>{storeName}</Text>
            <Text style={styles.subtitle}>
              {subjectKindLabel} {subjectLabel} | {verifiedAtLabel}
            </Text>
          </Section>

          <Section style={styles.statusPanel}>
            <Text style={styles.statusTitle}>{statusTitle}</Text>
            <Text style={styles.statusSummary}>{statusSummary}</Text>
          </Section>

          {hasDifferences ? (
            <Section style={styles.section}>
              <Text style={styles.sectionTitle}>Checked and wrong</Text>
              <Text style={styles.sectionLead}>
                These fields were compared against the source records and
                disagreed.
              </Text>
              {differences.map((difference) => (
                <Text key={difference.label} style={styles.difference}>
                  <strong style={styles.differenceLabel}>
                    {difference.label}
                  </strong>
                  <br />
                  Source records: {difference.expected} · Report shows:{" "}
                  {difference.actual}
                </Text>
              ))}
            </Section>
          ) : null}

          {notCheckedFields.length > 0 ? (
            // Deliberately its own panel with its own border colour: a
            // withheld field is not a clean field, and a reader must never be
            // able to mistake this list for the differences list above.
            <Section style={styles.notCheckedPanel}>
              <Text style={styles.notCheckedTitle}>Not checked</Text>
              <Text style={styles.notCheckedLead}>
                Verification made no claim about these fields in this run. They
                are not differences — and finding no difference here would not
                have meant they agree.
              </Text>
              {notCheckedFields.map((field) => (
                <Text key={field} style={styles.notCheckedField}>
                  {field}
                </Text>
              ))}
            </Section>
          ) : null}

          {explainedDifferences.length > 0 ? (
            <Section style={styles.section}>
              <Text style={styles.sectionTitle}>Recorded, not alerted</Text>
              <Text style={styles.sectionLead}>
                These differences are accounted for by a documented convention
                or a known blind spot, and need no action.
              </Text>
              {explainedDifferences.map((difference) => (
                <Text key={difference.label} style={styles.explained}>
                  <strong style={styles.differenceLabel}>
                    {difference.label}
                  </strong>
                  <br />
                  Source records: {difference.expected} · Report shows:{" "}
                  {difference.actual}
                  {difference.note ? (
                    <>
                      <br />
                      {difference.note}
                    </>
                  ) : null}
                </Text>
              ))}
            </Section>
          ) : null}

          <Section style={styles.actionSection}>
            <Button href={reviewUrl} style={styles.button}>
              Review reports ↗
            </Button>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default function ReportVerificationAlertPreview() {
  return <ReportVerificationAlert {...reportVerificationAlertPreviewProps} />;
}

const colors = {
  background: "#f6f6f4",
  border: "#e2e3e6",
  danger: "#dc4438",
  foreground: "#1b1c1f",
  muted: "#6f737b",
  surface: "#f8f8f6",
  warning: "#b66b00",
};

const fontFamily =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

const styles: Record<string, CSSProperties> = {
  actionSection: {
    padding: "24px 32px 32px",
    textAlign: "right",
  },
  body: {
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily,
    margin: 0,
    padding: "36px 0",
  },
  button: {
    ...operationalEmailOutlineButton,
  },
  difference: {
    borderLeft: `2px solid ${colors.danger}`,
    color: colors.foreground,
    fontSize: "14px",
    lineHeight: "21px",
    margin: "14px 0 0",
    paddingLeft: "12px",
  },
  differenceLabel: {
    fontWeight: 600,
  },
  explained: {
    borderLeft: `2px solid ${colors.border}`,
    color: colors.muted,
    fontSize: "13px",
    lineHeight: "20px",
    margin: "14px 0 0",
    paddingLeft: "12px",
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
  notCheckedField: {
    borderLeft: `2px solid ${colors.warning}`,
    color: colors.foreground,
    fontSize: "13px",
    lineHeight: "20px",
    margin: "10px 0 0",
    paddingLeft: "12px",
  },
  notCheckedLead: {
    color: colors.muted,
    fontSize: "13px",
    lineHeight: "19px",
    margin: "6px 0 0",
  },
  notCheckedPanel: {
    backgroundColor: colors.surface,
    borderBottom: `1px solid ${colors.border}`,
    borderLeft: `3px solid ${colors.warning}`,
    borderTop: `1px solid ${colors.border}`,
    padding: "22px 32px 24px 29px",
  },
  notCheckedTitle: {
    color: colors.foreground,
    fontSize: "16px",
    fontWeight: 600,
    lineHeight: "22px",
    margin: 0,
  },
  section: {
    borderTop: `1px solid ${colors.border}`,
    padding: "26px 32px 24px",
  },
  sectionLead: {
    color: colors.muted,
    fontSize: "13px",
    lineHeight: "19px",
    margin: "6px 0 0",
  },
  sectionTitle: {
    color: colors.muted,
    fontSize: "10px",
    fontWeight: 700,
    letterSpacing: "0.08em",
    lineHeight: "15px",
    margin: 0,
    textTransform: "uppercase",
  },
  shell: {
    backgroundColor: "#ffffff",
    margin: "0 auto",
    maxWidth: "640px",
    overflow: "hidden",
  },
  statusPanel: {
    backgroundColor: colors.surface,
    borderBottom: `1px solid ${colors.border}`,
    borderLeft: `3px solid ${colors.danger}`,
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
    margin: 0,
  },
  subtitle: {
    color: colors.muted,
    fontSize: "13px",
    lineHeight: "19px",
    margin: 0,
  },
  title: {
    color: colors.foreground,
    fontSize: "32px",
    fontWeight: 600,
    letterSpacing: "-0.025em",
    lineHeight: "37px",
    margin: "0 0 7px",
  },
};
