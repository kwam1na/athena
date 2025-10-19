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

interface NewOrderAdminProps {
  store_name: string;
  order_amount: string;
  order_status: string;
  order_date: string;
  customer_name: string;
  order_id: string;
  appUrl: string;
}

export default function NewOrderAdmin({
  store_name = "Wigclub",
  order_amount = "$150.00",
  order_status = "pending",
  order_date = "January 1, 2025",
  customer_name = "John Doe",
  order_id = "ORD-001",
  appUrl = "http://localhost:5173/admin/orders/ORD-001",
}: NewOrderAdminProps) {
  const orderUrl = appUrl;

  return (
    <Html>
      <Head />
      <Preview>🎉 New Order Received from {customer_name}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={heading}>New Order Alert! 🛍️</Text>
          <Text style={paragraph}>A new order has been placed!</Text>

          <Section style={detailsBox}>
            <Text style={detailsHeading}>Order Details:</Text>
            <Text style={detailText}>
              <strong>Customer:</strong> {customer_name}
            </Text>
            <Text style={detailText}>
              <strong>Amount:</strong> {order_amount}
            </Text>
            <Text style={detailText}>
              <strong>Status:</strong> {order_status}
            </Text>
            <Text style={detailText}>
              <strong>Date:</strong> {order_date}
            </Text>
          </Section>

          <Section style={buttonContainer}>
            <Button href={orderUrl} style={button}>
              View Order Details
            </Button>
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

const heading = {
  fontSize: "24px",
  fontWeight: "bold",
  color: "#333333",
  marginBottom: "20px",
};

const paragraph = {
  fontSize: "16px",
  lineHeight: "24px",
  marginBottom: "20px",
};

const detailsBox = {
  backgroundColor: "#f5f5f5",
  padding: "20px",
  borderRadius: "5px",
  margin: "20px 0",
};

const detailsHeading = {
  fontSize: "18px",
  fontWeight: "bold",
  marginTop: "0",
  marginBottom: "12px",
};

const detailText = {
  fontSize: "14px",
  lineHeight: "20px",
  margin: "8px 0",
};

const buttonContainer = {
  textAlign: "center" as const,
  margin: "30px 0",
};

const button = {
  backgroundColor: "#faeaf0",
  color: "#000",
  padding: "12px 24px",
  textDecoration: "none",
  borderRadius: "5px",
  display: "inline-block",
  fontWeight: "bold",
};

const footer = {
  color: "#666666",
  fontSize: "14px",
  marginTop: "20px",
};
