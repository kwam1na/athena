import { Body, Container, Head, Html, Preview, Section, Text } from "@react-email/components";

export type WalkthroughRequestNotificationProps = {
  requestId: string; name: string; workEmail: string; businessName: string; phone?: string; businessNeed: string;
};

export function delinkUntrustedEmailText(value: string) {
  return value
    .replace(/\bhttps?:\/\/[^\s<>]+/gi, (url) =>
      url.replace("://", "[:]//").replace(/\./g, "[.]"),
    )
    .replace(/\b(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/[^\s<>]*)?/gi, (host) =>
      host.replace(/\./g, "[.]"),
    );
}

export default function WalkthroughRequestNotification(props: WalkthroughRequestNotificationProps) {
  return <Html><Head /><Preview>New Athena walkthrough request</Preview><Body style={{ backgroundColor: "#f5f5f4", fontFamily: "Arial, sans-serif" }}><Container style={{ backgroundColor: "#ffffff", padding: "28px" }}>
    <Text style={{ color: "#57534e", fontSize: "12px", textTransform: "uppercase" }}>Athena walkthrough request</Text>
    <Text style={{ fontSize: "22px", fontWeight: 600 }}>{props.businessName}</Text>
    <Section><Text><strong>Request ID:</strong> {props.requestId}</Text><Text><strong>Name:</strong> {props.name}</Text><Text><strong>Work email:</strong> {props.workEmail}</Text>{props.phone ? <Text><strong>Phone:</strong> {props.phone}</Text> : null}<Text><strong>Business need:</strong></Text><Text style={{ whiteSpace: "pre-wrap" }}>{delinkUntrustedEmailText(props.businessNeed)}</Text></Section>
  </Container></Body></Html>;
}
