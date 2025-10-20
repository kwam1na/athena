import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from "@react-email/components";

export type OrderEmailType = "confirmation" | "ready" | "complete" | "canceled";

interface OrderItem {
  text: string;
  image: string;
  price: string;
  discountedPrice?: string;
  savings?: string;
  quantity: string;
  length?: string;
  color: string;
}

interface OrderEmailProps {
  type: OrderEmailType;
  customerEmail: string;
  store_name: string;
  order_number: string;
  order_date: string;
  order_status_messaging: string;
  total: string;
  subtotal: string;
  delivery_fee?: string;
  discount?: string;
  items: OrderItem[];
  pickup_type: string;
  pickup_details: string;
  customer_name: string;
}

export default function OrderEmail({
  type = "confirmation",
  customerEmail = "customer@example.com",
  store_name = "Wigclub",
  order_number = "ORD-001",
  order_date = "January 1, 2025",
  order_status_messaging = "Your order has been confirmed",
  total = "$100.00",
  subtotal = "$120.00",
  delivery_fee,
  discount,
  items = [
    {
      text: "Sample Product",
      image:
        "https://athena-amzn-bucket.s3.eu-west-1.amazonaws.com/stores/nn7byz68a3j4tfjvgdf9evpt3n78kk38/assets/1d23a4ff-7f3c-4c8e-c7d2-6efc6a217079.webp",
      price: "$50.00",
      discountedPrice: "$45.00",
      savings: "$10.00",
      quantity: "2",
      color: "Black",
      length: "16 inches",
    },
    {
      text: "Another Product",
      image:
        "https://athena-amzn-bucket.s3.eu-west-1.amazonaws.com/stores/nn7byz68a3j4tfjvgdf9evpt3n78kk38/assets/1d23a4ff-7f3c-4c8e-c7d2-6efc6a217079.webp",
      price: "$30.00",
      quantity: "1",
      color: "Brown",
    },
  ],
  pickup_type = "Delivery",
  pickup_details = "123 Main Street, City, State",
  customer_name = "John Doe",
}: OrderEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Your Wigclub order #{order_number}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Img
            src="https://athena-amzn-bucket.s3.eu-west-1.amazonaws.com/stores/nn7byz68a3j4tfjvgdf9evpt3n78kk38/assets/1d23a4ff-7f3c-4c8e-c7d2-6efc6a217079.webp"
            alt="Wigclub"
            style={logo}
          />
          {["confirmation", "complete"].includes(type) && (
            <Text style={heading}>
              THANKS FOR YOUR ORDER,
              <br />
              {customer_name.toUpperCase()}
            </Text>
          )}

          {type === "ready" && (
            <Text style={heading}>
              GET EXCITED,
              <br />
              {customer_name.toUpperCase()}
            </Text>
          )}

          <Text style={paragraph}>{order_status_messaging}</Text>

          <Section style={infoBox}>
            <Text style={infoText}>
              <strong>Order Number:</strong> {order_number}
            </Text>
            <Text style={infoText}>
              <strong>Ordered on:</strong> {order_date}
            </Text>
          </Section>

          <Section style={itemsSection}>
            {items.map((item, index) => (
              <Section key={index}>
                <table style={itemTable}>
                  <tbody>
                    <tr>
                      <td style={itemImageCell}>
                        <Img
                          src={item.image}
                          alt={item.text}
                          style={itemImage}
                        />
                      </td>
                      <td style={itemDetailsCell}>
                        <Text style={itemName}>{item.text}</Text>
                        <Text style={itemAttributes}>
                          {item.color}
                          {item.length ? ` | ${item.length}` : ""}
                        </Text>
                        <Text style={itemAttributes}>Qty {item.quantity}</Text>
                      </td>
                      <td style={itemPriceCell}>
                        {item.discountedPrice ? (
                          <>
                            <Text style={itemPriceStrikethrough}>
                              {item.price}
                            </Text>
                            <Text style={itemSavings}>
                              {item.discountedPrice}
                            </Text>
                            {/* {item.savings && (
                              <Text style={itemSavings}>
                                Saved: {item.savings}
                              </Text>
                            )} */}
                          </>
                        ) : (
                          <Text style={itemPrice}>{item.price}</Text>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
                {index < items.length - 1 && <Hr style={itemDivider} />}
              </Section>
            ))}
          </Section>

          <Section style={infoBox}>
            <Text style={infoTextBold}>{pickup_type}</Text>
            <Text style={infoText}>{pickup_details}</Text>
            <Hr style={summaryDivider} />

            <Text style={infoText}>
              <strong>Subtotal:</strong> {subtotal}
            </Text>

            {discount && (
              <Text style={infoTextDiscount}>
                <strong>Discounts:</strong> -{discount}
              </Text>
            )}
            {delivery_fee && (
              <Text style={infoText}>
                <strong>Delivery Fee:</strong> {delivery_fee}
              </Text>
            )}

            <Text style={infoTextTotal}>
              <strong>Total:</strong> {total}
            </Text>
          </Section>

          <Text style={thankYou}>
            Thank you for shopping with {store_name}!
          </Text>

          <Hr style={footerDivider} />
          <Section style={footer}>
            <Text style={footerText}>
              Wigclub
              <br />
              2 Jungle Avenue, East Legon
              <br />
              Accra, Ghana
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

const logo = {
  width: "100%",
  height: "80px",
  objectFit: "cover" as const,
};

const heading = {
  fontSize: "32px",
  fontWeight: "900",
  marginTop: "20px",
  marginBottom: "20px",
  textColor: "#000000",
  lineHeight: "1.4",
};

const paragraph = {
  fontSize: "16px",
  lineHeight: "24px",
  marginBottom: "20px",
};

const infoBox = {
  marginTop: "20px",
  padding: "15px",
  backgroundColor: "#faeaf0",
  borderRadius: "4px",
};

const infoText = {
  fontSize: "14px",
  lineHeight: "20px",
  margin: "8px 0",
};

const infoTextBold = {
  fontSize: "14px",
  lineHeight: "20px",
  margin: "8px 0",
  fontWeight: "bold",
  textTransform: "capitalize" as const,
};

const itemsSection = {
  marginTop: "20px",
  marginBottom: "20px",
};

const itemTable = {
  width: "100%",
  borderCollapse: "collapse" as const,
};

const itemImageCell = {
  padding: "10px",
  width: "80px",
};

const itemImage = {
  width: "60px",
  height: "60px",
  objectFit: "cover" as const,
  borderRadius: "4px",
};

const itemDetailsCell = {
  padding: "10px",
};

const itemName = {
  fontWeight: "bold",
  margin: "0 0 4px 0",
  fontSize: "14px",
};

const itemAttributes = {
  margin: "2px 0",
  fontSize: "14px",
  color: "#666666",
};

const itemPriceCell = {
  padding: "10px",
  textAlign: "right" as const,
  verticalAlign: "top" as const,
};

const itemPrice = {
  fontSize: "14px",
  fontWeight: "bold",
};

const itemPriceStrikethrough = {
  fontSize: "12px",
  color: "#999999",
  textDecoration: "line-through",
  margin: "0 0 4px 0",
};

const itemSavings = {
  fontSize: "14px",
  color: "#ee5d92",
  fontWeight: "bold",
};

const itemDivider = {
  borderColor: "#eeeeee",
  margin: "0",
};

const summaryDivider = {
  borderColor: "#dddddd",
  margin: "12px 0",
};

const infoTextDiscount = {
  fontSize: "14px",
  lineHeight: "20px",
  margin: "8px 0",
  color: "#ee5d92",
};

const infoTextTotal = {
  fontSize: "16px",
  lineHeight: "32px",
  margin: "8px 0",
  fontWeight: "bold",
};

const thankYou = {
  fontSize: "16px",
  marginTop: "20px",
};

const footerDivider = {
  marginTop: "30px",
  borderColor: "#eeeeee",
};

const footer = {
  marginTop: "20px",
};

const footerText = {
  color: "#666666",
  fontSize: "12px",
  lineHeight: "18px",
};
