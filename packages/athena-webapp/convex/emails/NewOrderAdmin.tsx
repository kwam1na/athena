import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from "@react-email/components";

interface OrderItem {
  text: string;
  image: string;
  price: string;
  discountedPrice?: string;
  savings?: string;
  quantity: string;
  color: string;
  length?: string;
}

interface NewOrderAdminProps {
  store_name: string;
  order_amount: string;
  order_status: string;
  order_date: string;
  customer_name: string;
  order_id: string;
  appUrl: string;
  order_number: string;
  items: OrderItem[];
  delivery_method: string;
  delivery_details: string;
  delivery_fee?: string;
  discount?: string;
  subtotal: string;
}

export default function NewOrderAdmin({
  store_name = "Wigclub",
  order_amount = "$150.00",
  order_status = "pending",
  order_date = "January 1, 2025",
  customer_name = "John Doe",
  order_id = "ORD-001",
  appUrl = "http://localhost:5173/admin/orders/ORD-001",
  order_number = "WC-001",
  items = [],
  delivery_method = "delivery",
  delivery_details = "123 Main Street, Accra",
  delivery_fee,
  discount,
  subtotal = "$150.00",
}: NewOrderAdminProps) {
  const orderUrl = appUrl;

  return (
    <Html>
      <Head />
      <Preview>New order from {customer_name}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={detailsBox}>
            <Text style={detailsHeading}>Order #{order_number}</Text>
            <Text style={detailText}>
              <strong>Customer:</strong> {customer_name}
            </Text>
            <Text style={detailText}>
              <strong>Status:</strong> {order_status}
            </Text>
            <Text style={detailText}>
              <strong>Date:</strong> {order_date}
            </Text>
          </Section>

          {items.length > 0 && (
            <Section style={itemsSection}>
              <Text style={sectionHeading}>Items</Text>
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
                          <Text style={itemAttributes}>
                            Qty {item.quantity}
                          </Text>
                        </td>
                        <td style={itemPriceCell}>
                          {item.discountedPrice ? (
                            <>
                              <Text style={itemPriceStrikethrough}>
                                {item.price}
                              </Text>
                              <Text style={itemDiscountedPrice}>
                                {item.discountedPrice}
                              </Text>
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
          )}

          <Section style={detailsBox}>
            <Text style={sectionHeadingBold}>{delivery_method}</Text>
            <Text style={detailText}>{delivery_details}</Text>
            <Hr style={summaryDivider} />

            <Text style={detailText}>
              <strong>Subtotal:</strong> {subtotal}
            </Text>

            {discount && (
              <Text style={discountText}>
                <strong>Discounts:</strong> -{discount}
              </Text>
            )}
            {delivery_fee && (
              <Text style={detailText}>
                <strong>Delivery Fee:</strong> {delivery_fee}
              </Text>
            )}

            <Text style={totalText}>
              <strong>Total:</strong> {order_amount}
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

const sectionHeading = {
  fontSize: "16px",
  fontWeight: "bold",
  marginBottom: "12px",
};

const sectionHeadingBold = {
  fontSize: "14px",
  fontWeight: "bold",
  margin: "8px 0",
  textTransform: "capitalize" as const,
};

const detailText = {
  fontSize: "14px",
  lineHeight: "20px",
  margin: "8px 0",
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

const itemDiscountedPrice = {
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

const discountText = {
  fontSize: "14px",
  lineHeight: "20px",
  margin: "8px 0",
  color: "#ee5d92",
};

const totalText = {
  fontSize: "16px",
  lineHeight: "32px",
  margin: "8px 0",
  fontWeight: "bold",
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
