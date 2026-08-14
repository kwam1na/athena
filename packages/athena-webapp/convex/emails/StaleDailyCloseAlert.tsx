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

export interface StaleDailyCloseAlertProps {
  ageInDays: number;
  blockerSummaries: string[];
  operatingDate: string;
  reportUrl: string;
  storeName: string;
}

export const staleDailyCloseAlertPreviewProps = {
  ageInDays: 2,
  blockerSummaries: [
    "An open register session is preventing automatic completion.",
  ],
  operatingDate: "Wednesday, Aug 12",
  reportUrl:
    "https://athena-os.app/wigclub/store/wigclub/operations/daily-close?operatingDate=2026-08-12",
  storeName: "Wigclub",
} satisfies StaleDailyCloseAlertProps;

export function StaleDailyCloseAlert({
  ageInDays,
  blockerSummaries,
  operatingDate,
  reportUrl,
  storeName,
}: StaleDailyCloseAlertProps) {
  const dayLabel = ageInDays === 1 ? "day" : "days";
  const previewText = `This operating day has remained open for ${ageInDays} ${dayLabel}.`;

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={styles.body}>
        <Container style={styles.shell}>
          <Section style={styles.header}>
            <Text style={styles.eyebrow}>{storeName} · EOD Review</Text>
            <Text style={styles.headline}>
              Still open after {ageInDays} {dayLabel}
            </Text>
          </Section>

          <Section style={styles.statusPanel}>
            <Text style={styles.statusSummary}>
              {operatingDate} has remained open for {ageInDays} {dayLabel}.
              Athena has continued checking it but cannot complete the close
              automatically.
            </Text>
          </Section>

          <Section style={styles.details}>
            <Text style={styles.sectionTitle}>What needs attention</Text>
            {(blockerSummaries.length > 0
              ? blockerSummaries
              : ["Review the remaining items before completing EOD Review."]
            ).map((summary) => (
              <Text key={summary} style={styles.blocker}>
                {summary}
              </Text>
            ))}
            <Text style={styles.retryNote}>
              Athena will continue retrying while this operating day remains
              within the automatic recovery window.
            </Text>
          </Section>

          <Section style={styles.action}>
            <Button href={reportUrl} style={styles.button}>
              Review EOD Review ↗
            </Button>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default function StaleDailyCloseAlertPreview() {
  return <StaleDailyCloseAlert {...staleDailyCloseAlertPreviewProps} />;
}

const colors = {
  background: "#f5f5f3",
  border: "#e2e3e6",
  foreground: "#1b1c1f",
  muted: "#6f737b",
  surface: "#fafaf8",
  warning: "#b45309",
};

const fontFamily =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

const styles: Record<string, CSSProperties> = {
  action: { padding: "8px 32px 32px", textAlign: "right" },
  blocker: {
    borderLeft: `2px solid ${colors.border}`,
    color: colors.foreground,
    fontSize: "14px",
    lineHeight: "21px",
    margin: "14px 0 0",
    paddingLeft: "12px",
  },
  body: {
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily,
    margin: 0,
    padding: "36px 0",
  },
  button: { ...operationalEmailOutlineButton },
  details: { padding: "26px 32px 18px" },
  eyebrow: {
    color: colors.muted,
    fontSize: "10px",
    fontWeight: 700,
    letterSpacing: "0.11em",
    lineHeight: "15px",
    margin: "0 0 10px",
    textTransform: "uppercase",
  },
  header: { padding: "36px 32px 24px" },
  headline: {
    color: colors.foreground,
    fontSize: "24px",
    fontWeight: 650,
    letterSpacing: "-0.02em",
    lineHeight: "29px",
    margin: 0,
  },
  retryNote: {
    color: colors.muted,
    fontSize: "13px",
    lineHeight: "20px",
    margin: "24px 0 0",
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
    borderLeft: `3px solid ${colors.warning}`,
    borderTop: `1px solid ${colors.border}`,
    padding: "20px 32px 21px 29px",
  },
  statusSummary: {
    color: colors.foreground,
    fontSize: "14px",
    lineHeight: "22px",
    margin: "7px 0 0",
  },
};
