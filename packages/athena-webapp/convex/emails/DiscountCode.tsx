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

interface DiscountCodeProps {
  customerEmail: string;
  discountText: string;
  promoCode: string;
  heroImageUrl: string;
  promoCodeEndDate: string;
  promoCodeSpan: "entire-order" | "selected-products";
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

export default function DiscountCode({
  customerEmail = "customer@example.com",
  discountText = "20%",
  promoCode = "SAVE20",
  heroImageUrl = "https://via.placeholder.com/600x300/ff6b6b/ffffff?text=Special+Offer",
  promoCodeEndDate = "2025-02-01",
  promoCodeSpan = "entire-order" as const,
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
}: DiscountCodeProps) {
  const expirationDate = new Date(promoCodeEndDate).toLocaleDateString(
    "en-US",
    {
      month: "long",
      day: "numeric",
    }
  );
  const isEntireOrder = promoCodeSpan === "entire-order";

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
        🎉 Exclusive {discountText} Off - Use Code {promoCode}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={heroSection}>
            <Img src={heroImageUrl} alt="Special Offer" style={heroImage} />
          </Section>

          <Text style={mainHeading}>🎉 Exclusive {discountText} Off!</Text>

          <Section style={promoBox}>
            <Text style={promoHeading}>Use Code: {promoCode}</Text>
            <Text style={promoSubtext}>
              {isEntireOrder
                ? "Valid on your entire order!"
                : "Valid on selected products!"}
            </Text>
            <Text style={promoExpiry}>Expires {expirationDate}</Text>
          </Section>

          <Section style={buttonContainer}>
            <Button href={shopUrl} style={mainButton}>
              Shop Now 🛍️
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

          <Section style={footerSection}>
            <Text style={footerText}>
              This offer expires on {expirationDate}. Don't miss out!
            </Text>
            <Text style={footerText}>
              Happy shopping from the Wigclub team! 💕
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
  color: "#333333",
  fontSize: "28px",
  fontWeight: "bold",
  marginBottom: "20px",
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

const promoExpiry = {
  margin: "5px 0 0 0",
  fontSize: "14px",
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

const footerSection = {
  marginTop: "40px",
  textAlign: "center" as const,
};

const footerText = {
  color: "#666666",
  fontSize: "12px",
  lineHeight: "18px",
  margin: "5px 0",
};
