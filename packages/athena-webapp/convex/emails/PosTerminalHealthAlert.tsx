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

export interface PosTerminalHealthAlertProps {
  storeName: string;
  terminalLabel: string;
  conditionSummaries: string[];
  observedAtLabel: string;
  healthUrl: string;
}

export const posTerminalHealthAlertPreviewProps = {
  conditionSummaries: [
    "Offline sales on this terminal are held and not syncing.",
    "Local storage on this terminal is critically degraded.",
  ],
  healthUrl:
    "https://athena.wigclub.store/wigclub/store/wigclub/pos/terminals/terminal-1",
  observedAtLabel: "Reported just now",
  storeName: "Wigclub",
  terminalLabel: "Front counter / Register 2",
} satisfies PosTerminalHealthAlertProps;

export default function PosTerminalHealthAlert({
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
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Text style={headingStyle}>POS terminal needs attention</Text>
          <Text style={paragraphStyle}>
            {storeName} — {terminalLabel}
          </Text>
          <Text style={mutedStyle}>{observedAtLabel}</Text>
          <Section>
            {conditionSummaries.map((summary) => (
              <Text key={summary} style={conditionStyle}>
                • {summary}
              </Text>
            ))}
          </Section>
          <Text style={paragraphStyle}>
            Sales continue locally on the terminal. Review terminal health to
            resolve the condition before local data pressure builds.
          </Text>
          <Button href={healthUrl} style={buttonStyle}>
            Open terminal health
          </Button>
        </Container>
      </Body>
    </Html>
  );
}

const bodyStyle = {
  backgroundColor: "#f6f6f6",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  margin: 0,
  padding: "24px 0",
};

const containerStyle = {
  backgroundColor: "#ffffff",
  borderRadius: "8px",
  margin: "0 auto",
  maxWidth: "520px",
  padding: "32px",
};

const headingStyle = {
  color: "#111111",
  fontSize: "18px",
  fontWeight: 600,
  margin: "0 0 12px",
};

const paragraphStyle = {
  color: "#333333",
  fontSize: "14px",
  lineHeight: "22px",
  margin: "0 0 8px",
};

const mutedStyle = {
  color: "#777777",
  fontSize: "12px",
  margin: "0 0 16px",
};

const conditionStyle = {
  color: "#8a2b2b",
  fontSize: "14px",
  lineHeight: "22px",
  margin: "0 0 4px",
};

const buttonStyle = {
  backgroundColor: "#111111",
  borderRadius: "6px",
  color: "#ffffff",
  display: "inline-block",
  fontSize: "14px",
  marginTop: "16px",
  padding: "10px 18px",
  textDecoration: "none",
};
