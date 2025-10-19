import {
  Body,
  Container,
  Head,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

interface VerificationCodeProps {
  customerEmail: string;
  verificationCode: string;
  storeName?: string;
  validTime: string;
}

export default function VerificationCode({
  customerEmail = "customer@example.com",
  verificationCode = "123456",
  storeName = "Wigclub",
  validTime = "10 minutes",
}: VerificationCodeProps) {
  return (
    <Html>
      <Head />
      <Preview>Your verification code for {storeName}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={section}>
            <Text style={heading}>Email Verification</Text>
            <Text style={paragraph}>Hello,</Text>
            <Text style={paragraph}>
              Your verification code for {storeName} is:
            </Text>
            <Section style={codeContainer}>
              <Text style={code}>{verificationCode}</Text>
            </Section>
            <Text style={paragraph}>This code is valid for {validTime}.</Text>
            <Text style={paragraph}>
              If you didn't request this code, please ignore this email.
            </Text>
            <Text style={paragraph}>
              Best regards,
              <br />
              {storeName} Team
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const main = {
  backgroundColor: "#ffffff",
  fontFamily: "Arial, sans-serif",
};

const container = {
  margin: "0 auto",
  maxWidth: "600px",
  padding: "20px",
};

const section = {
  padding: "20px 0",
};

const heading = {
  fontSize: "24px",
  fontWeight: "bold",
  marginBottom: "20px",
};

const paragraph = {
  fontSize: "16px",
  lineHeight: "24px",
  marginBottom: "16px",
};

const codeContainer = {
  backgroundColor: "#f5f5f5",
  padding: "20px",
  textAlign: "center" as const,
  margin: "20px 0",
};

const code = {
  fontSize: "24px",
  fontWeight: "bold",
  letterSpacing: "3px",
  margin: "0",
};
