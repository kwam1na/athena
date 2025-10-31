import {
  Body,
  Button,
  Container,
  Head,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from "@react-email/components";

interface FeedbackRequestProps {
  customerEmail: string;
  customer_name: string;
  product_name: string;
  product_image_url: string;
  review_url: string;
}

export default function FeedbackRequest({
  customerEmail = "customer@example.com",
  customer_name = "John Doe",
  product_name = "Premium Hair Extension",
  product_image_url = "https://via.placeholder.com/200x200/cccccc/666666?text=Product",
  review_url = "https://example.com/review",
}: FeedbackRequestProps) {
  return (
    <Html>
      <Head />
      <Preview>How was your recent purchase?</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={heading}>We'd love to hear from you! ⭐</Text>
          <Text style={paragraph}>Hello {customer_name},</Text>
          <Text style={paragraph}>
            Thank you for your recent purchase. We hope you're loving your new
            item!
          </Text>

          <Section style={productSection}>
            <Img
              src={product_image_url}
              alt={product_name}
              style={productImage}
            />
            <Text style={productName}>{product_name}</Text>
          </Section>

          <Text style={paragraph}>
            Your feedback helps us improve and helps other customers make
            informed decisions. Could you take a moment to share your
            experience?
          </Text>

          <Section style={buttonContainer}>
            <Button href={review_url} style={button}>
              Leave a Review ⭐
            </Button>
          </Section>

          <Text style={paragraph}>Thank you for choosing Wigclub!</Text>
          <Text style={signature}>
            Best regards,
            <br />
            The Wigclub Team
          </Text>
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
  marginBottom: "20px",
};

const paragraph = {
  fontSize: "16px",
  lineHeight: "24px",
  marginBottom: "16px",
};

const productSection = {
  textAlign: "center" as const,
  margin: "30px 0",
  padding: "20px",
  backgroundColor: "#f9f9f9",
  borderRadius: "8px",
};

const productImage = {
  maxWidth: "200px",
  height: "auto",
  borderRadius: "5px",
  margin: "0 auto",
};

const productName = {
  fontSize: "18px",
  fontWeight: "bold",
  margin: "15px 0 5px 0",
};

const buttonContainer = {
  textAlign: "center" as const,
  margin: "30px 0",
};

const button = {
  backgroundColor: "#ee5d92",
  color: "#ffffff",
  padding: "15px 30px",
  textDecoration: "none",
  borderRadius: "8px",
  display: "inline-block",
  fontWeight: "bold",
};

const signature = {
  fontSize: "16px",
  lineHeight: "24px",
  marginTop: "20px",
};
