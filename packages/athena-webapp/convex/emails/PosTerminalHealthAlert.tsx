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

export interface PosTerminalHealthAlertProps {
  storeName: string;
  terminalLabel: string;
  conditionSummaries: string[];
  observedAtLabel: string;
  healthUrl: string;
}

export const posTerminalHealthAlertPreviewProps = {
  conditionSummaries: [
    "5 offline sales are waiting to sync.",
    "Storage is almost full. New offline sales may not be saved reliably.",
  ],
  healthUrl:
    "https://athena-os.app/wigclub/store/wigclub/pos/terminals/terminal-1",
  observedAtLabel: "Saturday, Aug 8 · Reported at 8:47 PM",
  storeName: "Wigclub",
  terminalLabel: "Front counter / Register 2",
} satisfies PosTerminalHealthAlertProps;

export function PosTerminalHealthAlert({
  storeName,
  terminalLabel,
  conditionSummaries,
  observedAtLabel,
  healthUrl,
}: PosTerminalHealthAlertProps) {
  const previewText = `${storeName}: ${terminalLabel} needs attention.`;

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={styles.body}>
        <Container style={styles.shell}>
          <Section style={styles.header}>
            <Text style={styles.eyebrow}>Athena terminal health</Text>
            <Text style={styles.title}>{storeName}</Text>
            <Text style={styles.subtitle}>
              {terminalLabel} | {observedAtLabel}
            </Text>
          </Section>

          <Section style={styles.statusPanel}>
            <Text style={styles.statusTitle}>Terminal needs attention</Text>
            <Text style={styles.statusSummary}>
              Sales can continue, but this terminal’s local data needs review.
            </Text>
          </Section>

          <Section style={styles.section}>
            <Text style={styles.sectionTitle}>What needs attention</Text>
            {conditionSummaries.map((summary) => (
              <Text key={summary} style={styles.condition}>
                {summary}
              </Text>
            ))}
          </Section>

          <Section style={styles.actionSection}>
            <Button href={healthUrl} style={styles.button}>
              Review terminal health ↗
            </Button>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export default function PosTerminalHealthAlertPreview() {
  return <PosTerminalHealthAlert {...posTerminalHealthAlertPreviewProps} />;
}

const colors = {
  background: "#f6f6f4",
  border: "#e2e3e6",
  danger: "#dc4438",
  foreground: "#1b1c1f",
  muted: "#6f737b",
  surface: "#f8f8f6",
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
  condition: {
    borderLeft: `2px solid ${colors.border}`,
    color: colors.foreground,
    fontSize: "14px",
    lineHeight: "21px",
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
  section: {
    borderTop: `1px solid ${colors.border}`,
    padding: "26px 32px 24px",
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
