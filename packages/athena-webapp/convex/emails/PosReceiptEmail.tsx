import type { CSSProperties } from "react";
import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Section,
  Text,
} from "@react-email/components";

export interface PosReceiptCustomerInfo {
  name?: string;
  email?: string;
  phone?: string;
}

export interface PosReceiptStoreContact {
  street?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
  phone?: string;
  email?: string;
  website?: string;
}

export interface PosReceiptItem {
  name: string;
  totalPrice: string;
  quantityLabel: string;
  skuOrBarcode?: string;
  attributes?: string;
}

export interface PosReceiptEmailProps {
  storeName: string;
  storeContact?: PosReceiptStoreContact;
  receiptNumber: string;
  completedDate: string;
  completedTime: string;
  registerNumber?: string;
  cashierName?: string;
  customerInfo?: PosReceiptCustomerInfo;
  items: Array<PosReceiptItem>;
  itemsCount: number;
  subtotal: string;
  tax?: string;
  total: string;
  paymentMethodLabel: string;
}

const sectionBorder = {
  //   borderBottom: "1px dashed #cccccc",
  paddingBottom: "16px",
  marginBottom: "48px",
};

const mockItems: Array<PosReceiptItem> = [
  {
    name: "Product 1",
    totalPrice: "$10.00",
    quantityLabel: "1 x $10.00",
    skuOrBarcode: "1234567890",
  },
  {
    name: "Product 2",
    totalPrice: "$20.00",
    quantityLabel: "2 x $10.00",
    skuOrBarcode: "1234567891",
  },
  {
    name: "Product 3",
    totalPrice: "$30.00",
    quantityLabel: "3 x $10.00",
    skuOrBarcode: "1234567892",
  },
  {
    name: "Product 4",
    totalPrice: "$40.00",
    quantityLabel: "4 x $10.00",
    skuOrBarcode: "1234567893",
  },
];

export default function PosReceiptEmail({
  storeName = "Wigclub",
  storeContact = {
    street: "2 Jungle Avenue",
    city: "East Legon",
    state: "Accra",
    country: "Ghana",
    phone: "+233555555555",
    website: "www.wigclub.store",
  },
  receiptNumber = "346372",
  completedDate = "01/12/2025",
  completedTime = "3:27 PM",
  cashierName = "John D.",
  registerNumber,
  customerInfo,
  items = mockItems,
  itemsCount,
  subtotal = "GHS 2,720",
  tax,
  total = "GHS 2,720",
  paymentMethodLabel = "Card Payment",
}: PosReceiptEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={sectionBorder}>
            <Text style={styles.storeName}>{storeName}</Text>
            {storeContact && (
              <div style={styles.contactBlock}>
                {storeContact.street && (
                  <Text style={styles.contact}>{storeContact.street}</Text>
                )}
                {(storeContact.city ||
                  storeContact.state ||
                  storeContact.zipCode) && (
                  <Text style={styles.contact}>
                    {[
                      storeContact.city,
                      storeContact.state,
                      storeContact.zipCode,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </Text>
                )}
                {storeContact.country && (
                  <Text style={styles.contact}>{storeContact.country}</Text>
                )}
                {storeContact.phone && (
                  <Text style={styles.contact}>Tel {storeContact.phone}</Text>
                )}
                {storeContact.email && (
                  <Text style={styles.contact}>
                    Email: {storeContact.email}
                  </Text>
                )}
                {storeContact.website && (
                  <Text style={styles.contact}>{storeContact.website}</Text>
                )}
              </div>
            )}
          </Section>

          <Section style={sectionBorder}>
            <Block>
              <LineItem>
                <DateTime date={completedDate} time={completedTime} />
                <Text>#{receiptNumber}</Text>
              </LineItem>
              <Text style={styles.cashierName}>Cashier: {cashierName}</Text>
            </Block>
          </Section>

          {/* {customerInfo &&
            (customerInfo.name || customerInfo.email || customerInfo.phone) && (
              <Section style={sectionBorder}>
                <Text style={styles.sectionHeading}>Customer Information</Text>
                {customerInfo.name && (
                  <Row label="Name:" value={customerInfo.name} />
                )}
                {customerInfo.email && (
                  <Row
                    label="Email:"
                    value={customerInfo.email}
                    valueStyle={styles.emailText}
                  />
                )}
                {customerInfo.phone && (
                  <Row label="Phone:" value={customerInfo.phone} />
                )}
              </Section>
            )} */}

          <Section style={sectionBorder}>
            {items.map((item, index) => (
              <div key={`${item.name}-${index}`} style={styles.itemBlock}>
                <div style={styles.itemTopRow}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  <Text style={styles.itemPrice}>{item.totalPrice}</Text>
                </div>
                <div style={styles.itemMetaRow}>
                  {item.skuOrBarcode && (
                    <Text style={styles.itemName}>{item.skuOrBarcode}</Text>
                  )}
                  <Text style={styles.itemName}>{item.quantityLabel}</Text>
                </div>
              </div>
            ))}
          </Section>

          <Section style={sectionBorder}>
            <Text>{itemsCount} items</Text>
            <Row label="Subtotal" value={subtotal} />
            {tax && <Row label="Tax:" value={tax} />}
            {/* <Hr style={styles.summaryDivider} /> */}
            <Row label="Total" value={total} valueStyle={styles.total} />
          </Section>

          <Section style={sectionBorder}>
            <Row
              label={paymentMethodLabel}
              value={total}
              valueStyle={styles.paymentMethod}
            />
          </Section>

          <Spacer height={80} />

          <Section>
            <Text style={styles.footerLine}>Thank you for your business!</Text>
            <Text style={styles.footerLine}>
              Please keep this receipt for your records.
            </Text>
            <Hr style={styles.footerDivider} />
            <Text style={styles.footerLine}>Powered by Athena POS</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

function Row({
  label,
  value,
  valueStyle,
}: {
  label: string;
  value: string;
  valueStyle?: CSSProperties;
}) {
  return (
    <div style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={{ ...styles.rowValue, ...valueStyle }}>{value}</Text>
    </div>
  );
}

function DateTime({ date, time }: { date: string; time: string }) {
  return (
    <div style={styles.dateTime}>
      <Text style={styles.dateTimeText}>{date}</Text>
      <Text style={styles.dateTimeText}>{time}</Text>
    </div>
  );
}

function LineItem({ children }: { children: React.ReactNode }) {
  return <div style={styles.lineItem}>{children}</div>;
}

function Block({ children }: { children: React.ReactNode }) {
  return <div style={styles.block}>{children}</div>;
}

function Spacer({ height = 16 }: { height?: number }) {
  return <div style={{ height: `${height}px` }} />;
}

const styles: Record<string, CSSProperties> = {
  body: {
    backgroundColor: "#ffffff",
    fontFamily: "'Courier New', monospace",
    color: "#000000",
  },
  container: {
    border: "1px solid #dddddd",
    borderRadius: "4px",
    maxWidth: "360px",
    margin: "0 auto",
    padding: "20px",
  },
  storeName: {
    textAlign: "center",
    fontWeight: 700,
    fontSize: "24px",
    marginBottom: "8px",
    textTransform: "uppercase" as const,
  },
  block: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "2px",
  },
  cashierName: {
    // fontSize: "12px",
    // fontWeight: 600,
    // textTransform: "uppercase" as const,
    marginTop: "0px",
  },
  contactBlock: {
    textAlign: "center" as const,
    marginBottom: "32px",
  },
  contact: {
    fontSize: "12px",
    margin: "2px 0",
    textTransform: "uppercase" as const,
  },
  sectionHeading: {
    fontWeight: 700,
    fontSize: "14px",
    marginBottom: "8px",
    textTransform: "uppercase" as const,
  },
  dateTime: {
    display: "flex",
    // flexDirection: "column" as const,
    gap: "8px",
    fontSize: "12px",
    fontWeight: 600,
  },
  dateTimeText: {
    fontSize: "14px",
  },
  lineItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    // marginBottom: "4px",
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: "12px",
    marginBottom: "6px",
  },
  rowLabel: {
    fontWeight: 600,
    marginRight: "8px",
  },
  rowValue: {
    fontWeight: 600,
  },
  emailText: {
    fontSize: "11px",
  },
  itemBlock: {
    paddingBottom: "24px",
  },
  itemTopRow: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: "12px",
    fontWeight: 600,
  },
  itemName: {
    maxWidth: "220px",
  },
  itemPrice: {
    whiteSpace: "nowrap" as const,
    // fontSize: "16px",
  },
  itemMetaRow: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: "11px",
    // color: "#555555",
    marginTop: "0px",
    paddingTop: "0px",
    fontWeight: 800,
  },
  itemMeta: {
    fontSize: "11px",
    color: "#555555",
  },
  itemDivider: {
    borderColor: "#eeeeee",
    // marginTop: "12px",
  },
  summaryDivider: {
    borderColor: "#dddddd",
    margin: "8px 0",
  },
  total: {
    fontSize: "14px",
    fontWeight: 700,
  },
  paymentMethod: {
    fontWeight: 700,
  },
  footerLine: {
    textAlign: "center" as const,
    fontSize: "12px",
    margin: "6px 0",
  },
  footerLineMuted: {
    textAlign: "center" as const,
    fontSize: "10px",
    color: "#666666",
    marginTop: "10px",
  },
  footerDivider: {
    borderColor: "#eeeeee",
    margin: "16px 0",
  },
};
