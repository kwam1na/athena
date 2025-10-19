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

interface ProductItem {
  image: string;
  name: string;
  original_price: string;
  discounted_price: string;
  product_url: string;
}

interface DiscountReminderProps {
  customerEmail: string;
  discountText: string;
  promoCode: string;
  heroImageUrl: string;
  bestSellers: ProductItem[];
  recentlyViewed: ProductItem[];
  shopUrl: string;
}

const ProductCard = ({ product }: { product: ProductItem }) => (
  <td style={productCell}>
    <Section style={productCard}>
      <Img src={product.image} alt={product.name} style={productImage} />
      <Text style={productName}>{product.name}</Text>
      <Text style={originalPrice}>{product.original_price}</Text>
      <Text style={discountedPrice}>{product.discounted_price}</Text>
      <Button href={product.product_url} style={shopNowButton}>
        Shop Now
      </Button>
    </Section>
  </td>
);

export default function DiscountReminder({
  customerEmail = "customer@example.com",
  discountText = "20%",
  promoCode = "SAVE20",
  heroImageUrl = "https://via.placeholder.com/600x300/ff6b6b/ffffff?text=Last+Chance",
  bestSellers = [
    {
      image: "https://via.placeholder.com/120x120/cccccc/666666?text=Product",
      name: "Best Seller 1",
      original_price: "$100.00",
      discounted_price: "$80.00",
      product_url: "https://example.com/product1",
    },
    {
      image: "https://via.placeholder.com/120x120/cccccc/666666?text=Product",
      name: "Best Seller 2",
      original_price: "$150.00",
      discounted_price: "$120.00",
      product_url: "https://example.com/product2",
    },
  ],
  recentlyViewed = [
    {
      image: "https://via.placeholder.com/120x120/cccccc/666666?text=Product",
      name: "Recently Viewed 1",
      original_price: "$80.00",
      discounted_price: "$64.00",
      product_url: "https://example.com/product3",
    },
    {
      image: "https://via.placeholder.com/120x120/cccccc/666666?text=Product",
      name: "Recently Viewed 2",
      original_price: "$120.00",
      discounted_price: "$96.00",
      product_url: "https://example.com/product4",
    },
  ],
  shopUrl = "https://example.com/shop",
}: DiscountReminderProps) {
  // Chunk products into pairs for two-column layout
  const chunkProducts = (products: ProductItem[]) => {
    const chunks: ProductItem[][] = [];
    for (let i = 0; i < products.length; i += 2) {
      chunks.push(products.slice(i, i + 2));
    }
    return chunks;
  };

  return (
    <Html>
      <Head />
      <Preview>
        ⏰ Last Chance! Your {discountText} Discount Expires Soon
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={heroSection}>
            <Img src={heroImageUrl} alt="Last Chance Offer" style={heroImage} />
          </Section>

          <Text style={mainHeading}>⏰ Last Chance!</Text>

          <Text style={urgentText}>
            Your {discountText} discount expires on July 20!
          </Text>

          <Section style={promoBox}>
            <Text style={promoHeading}>Use Code: {promoCode}</Text>
            <Text style={promoSubtext}>Don't let this deal slip away!</Text>
          </Section>

          <Section style={buttonContainer}>
            <Button href={shopUrl} style={mainButton}>
              Shop Now Before It's Gone! 🏃‍♀️
            </Button>
          </Section>

          {bestSellers.length > 0 && (
            <>
              <Text style={sectionHeading}>✨ Best Sellers</Text>
              <table style={productsTable}>
                <tbody>
                  {chunkProducts(bestSellers).map((chunk, idx) => (
                    <tr key={idx}>
                      {chunk.map((product, pIdx) => (
                        <ProductCard key={pIdx} product={product} />
                      ))}
                      {chunk.length === 1 && <td style={productCell}></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {recentlyViewed.length > 0 && (
            <>
              <Text style={sectionHeading}>👀 Recently Viewed</Text>
              <table style={productsTable}>
                <tbody>
                  {chunkProducts(recentlyViewed).map((chunk, idx) => (
                    <tr key={idx}>
                      {chunk.map((product, pIdx) => (
                        <ProductCard key={pIdx} product={product} />
                      ))}
                      {chunk.length === 1 && <td style={productCell}></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <Section style={warningBox}>
            <Text style={warningHeading}>
              ⚠️ Hurry! This offer expires on July 20
            </Text>
            <Text style={warningText}>Once it's gone, it's gone!</Text>
          </Section>

          <Text style={footerText}>
            Happy shopping from the Wigclub team! 💕
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

const heroSection = {
  textAlign: "center" as const,
  marginBottom: "30px",
};

const heroImage = {
  maxWidth: "100%",
  height: "auto",
};

const mainHeading = {
  textAlign: "center" as const,
  color: "#ff6b6b",
  fontSize: "28px",
  fontWeight: "bold",
  marginBottom: "20px",
};

const urgentText = {
  textAlign: "center" as const,
  fontSize: "18px",
  color: "#333333",
  marginBottom: "30px",
};

const promoBox = {
  textAlign: "center" as const,
  backgroundColor: "#ff6b6b",
  color: "#ffffff",
  padding: "20px",
  borderRadius: "10px",
  margin: "30px 0",
};

const promoHeading = {
  margin: "0",
  fontSize: "24px",
  fontWeight: "bold",
};

const promoSubtext = {
  margin: "10px 0 0 0",
  fontSize: "16px",
};

const buttonContainer = {
  textAlign: "center" as const,
  margin: "30px 0",
};

const mainButton = {
  backgroundColor: "#007cba",
  color: "#ffffff",
  padding: "15px 30px",
  textDecoration: "none",
  borderRadius: "25px",
  display: "inline-block",
  fontWeight: "bold",
  fontSize: "18px",
};

const sectionHeading = {
  textAlign: "center" as const,
  color: "#333333",
  fontSize: "20px",
  fontWeight: "bold",
  margin: "40px 0 20px 0",
};

const productsTable = {
  width: "100%",
  borderCollapse: "collapse" as const,
};

const productCell = {
  width: "50%",
  padding: "10px",
};

const productCard = {
  textAlign: "center" as const,
};

const productImage = {
  width: "120px",
  height: "120px",
  objectFit: "cover" as const,
  borderRadius: "5px",
  margin: "0 auto",
};

const productName = {
  margin: "10px 0 5px 0",
  fontSize: "14px",
  fontWeight: "bold",
};

const originalPrice = {
  margin: "0",
  color: "#666666",
  textDecoration: "line-through",
  fontSize: "14px",
};

const discountedPrice = {
  margin: "0",
  color: "#ff6b6b",
  fontWeight: "bold",
  fontSize: "14px",
};

const shopNowButton = {
  display: "inline-block",
  marginTop: "8px",
  backgroundColor: "#007cba",
  color: "#ffffff",
  padding: "8px 15px",
  textDecoration: "none",
  borderRadius: "3px",
  fontSize: "12px",
};

const warningBox = {
  marginTop: "40px",
  textAlign: "center" as const,
  backgroundColor: "#fff3cd",
  padding: "15px",
  borderRadius: "5px",
  borderLeft: "4px solid #ffc107",
};

const warningHeading = {
  margin: "0",
  fontWeight: "bold",
  color: "#856404",
  fontSize: "14px",
};

const warningText = {
  margin: "5px 0 0 0",
  color: "#856404",
  fontSize: "14px",
};

const footerText = {
  textAlign: "center" as const,
  marginTop: "30px",
  color: "#666666",
  fontSize: "14px",
};
