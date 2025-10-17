import { capitalizeWords } from "../utils";

const MAILERSEND_API_URL = "https://api.mailersend.com/v1/email";

export const sendVerificationCode = async (params: {
  customerEmail: string;
  verificationCode: string;
  storeName?: string;
  validTime: string;
}) => {
  const storeName = params.storeName
    ? capitalizeWords(params.storeName)
    : "Wigclub";

  const message = {
    from: {
      email: "noreply@wigclub.store",
      name: storeName,
    },
    to: [
      {
        email: params.customerEmail,
        name: "",
      },
    ],
    subject: "Email Verification Code",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Email Verification</h2>
        <p>Hello,</p>
        <p>Your verification code for ${storeName} is:</p>
        <div style="background-color: #f5f5f5; padding: 20px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 3px; margin: 20px 0;">
          ${params.verificationCode}
        </div>
        <p>This code is valid for ${params.validTime}.</p>
        <p>If you didn't request this code, please ignore this email.</p>
        <p>Best regards,<br>${storeName} Team</p>
      </div>
    `,
    text: `
      Hello,

      Your verification code for ${storeName} is: ${params.verificationCode}

      This code is valid for ${params.validTime}.

      If you didn't request this code, please ignore this email.

      Best regards,
      ${storeName} Team
    `,
  };

  return await fetch(MAILERSEND_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.MAILERSEND_API_KEY}`,
    },
    body: JSON.stringify(message),
  });
};

export type OrderEmailType = "confirmation" | "ready" | "complete" | "canceled";

export const sendOrderEmail = async (params: {
  type: OrderEmailType;
  customerEmail: string;
  store_name: string;
  order_number: string;
  order_date: string;
  order_status_messaging: string;
  total: string;
  delivery_fee?: string;
  discount?: string;
  items: Array<{
    text: string;
    image: string;
    price: string;
    quantity: string;
    length?: string;
    color: string;
  }>;
  pickup_type: string;
  pickup_details: string;
  customer_name: string;
}) => {
  const itemsHtml = params.items
    .map(
      (item) => `
    <tr>
      <td style="padding: 10px; border-bottom: 1px solid #eee;">
        <img src="${item.image}" alt="${item.text}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 4px;">
      </td>
      <td style="padding: 10px; border-bottom: 1px solid #eee;">
        <strong>${item.text}</strong><br>
        ${item.color}${item.length ? ` | ${item.length}` : ""}<br>
        Qty ${item.quantity}
      </td>
      <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">
        ${item.price}
      </td>
    </tr>
  `
    )
    .join("");

  const message = {
    from: {
      email: "orders@wigclub.store",
      name: capitalizeWords(params.store_name),
    },
    to: [
      {
        email: params.customerEmail,
        name: params.customer_name,
      },
    ],
    subject: `Your Wigclub order`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <img src="https://athena-amzn-bucket.s3.eu-west-1.amazonaws.com/stores/nn7byz68a3j4tfjvgdf9evpt3n78kk38/assets/1d23a4ff-7f3c-4c8e-c7d2-6efc6a217079.webp" alt="Wigclub" style="width: 100%; height: 80px; object-fit: cover;">
        <h2>THANKS FOR <br>YOUR ORDER, <br> ${params.customer_name.toUpperCase()}</h2>
        <p>${params.order_status_messaging}</p>

        <div style="margin-top: 20px; padding: 15px; background-color: #f9f9f9;">
          <p><b>Order Number:</b> ${params.order_number}</p>
          <p><b>Ordered on:</b> ${params.order_date}</p>
        </div>
        
        <table style="width: 100%; border-collapse: collapse;">
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>
        
        <div style="margin-top: 20px; padding: 15px; background-color: #f9f9f9;">
          <p><b>${params.pickup_type}</b></p>
          <p>${params.pickup_details}</p>
          ${params.delivery_fee ? `<p><strong>Delivery Fee:</strong> ${params.delivery_fee}</p>` : ""}
          ${params.discount ? `<p><strong>Discount:</strong> ${params.discount}</p>` : ""}
          <p><strong>Total:</strong> ${params.total}</p>
        </div>
        
        <p style="margin-top: 20px;">
          Thank you for shopping with ${params.store_name}!
        </p>
        
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; color: #666; font-size: 12px;">
          <p>Wigclub<br>2 Jungle Avenue, East Legon<br>Accra, Ghana</p>
        </div>
      </div>
    `,
    text: `
      Order ${params.order_status_messaging}

      Dear ${params.customer_name.toUpperCase()},

      Your order #${params.order_number} placed on ${params.order_date} has been ${params.order_status_messaging}.

      Order Items:
      ${params.items
        .map(
          (item) =>
            `- ${item.text} (${item.color}${
              item.length ? `, ${item.length}` : ""
            }) x${item.quantity} - ${item.price}`
        )
        .join("\n")}

      Pickup Type: ${capitalizeWords(params.pickup_type)}
      Pickup Details: ${params.pickup_details}
      ${params.delivery_fee ? `Delivery Fee: ${params.delivery_fee}` : ""}
      ${params.discount ? `Discount: ${params.discount}` : ""}
      Total: ${params.total}

      Thank you for shopping with ${params.store_name}!

      ---
      Wigclub
      2 Jungle Avenue, East Legon
      Accra, Ghana
    `,
  };

  return await fetch(MAILERSEND_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.MAILERSEND_API_KEY}`,
    },
    body: JSON.stringify(message),
  });
};

export const sendNewOrderEmail = async (params: {
  store_name: string;
  order_amount: string;
  order_status: string;
  order_date: string;
  customer_name: string;
  order_id: string;
}) => {
  const appUrl =
    process.env.STAGE == "prod"
      ? "https://athena.wigclub.store"
      : "http://localhost:5173";

  const orderUrl = `${appUrl}/wigclub/store/wigclub/orders/${params.order_id}`;

  const message = {
    from: {
      email: "orders@wigclub.store",
      name: capitalizeWords(params.store_name),
    },
    to: [
      {
        email: "essuahmensahmaud@gmail.com",
        name: "Admin",
      },
      {
        email: "kwamina.0x00@gmail.com",
        name: "Admin",
      },
    ],
    subject: "🎉 New Order Received!",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">New Order Alert! 🛍️</h2>
        <p>A new order has been placed!</p>
        
        <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px; margin: 20px 0;">
          <h3 style="margin-top: 0;">Order Details:</h3>
          <p><strong>Customer:</strong> ${params.customer_name}</p>
          <p><strong>Amount:</strong> ${params.order_amount}</p>
          <p><strong>Status:</strong> ${params.order_status}</p>
          <p><strong>Date:</strong> ${params.order_date}</p>
        </div>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${orderUrl}" style="background-color: #007cba; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
            View Order Details
          </a>
        </div>
        
        <p style="color: #666; font-size: 14px;">
          Please check the admin panel to process this order.
        </p>
      </div>
    `,
    text: `
      New Order Alert!

      A new order has been placed!

      Order Details:
      Customer: ${params.customer_name}
      Amount: ${params.order_amount}
      Status: ${params.order_status}
      Date: ${params.order_date}

      View order details: ${orderUrl}

      Please check the admin panel to process this order.
    `,
  };

  return await fetch(MAILERSEND_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.MAILERSEND_API_KEY}`,
    },
    body: JSON.stringify(message),
  });
};

export const sendFeedbackRequestEmail = async (params: {
  customerEmail: string;
  customer_name: string;
  product_name: string;
  product_image_url: string;
  review_url: string;
}) => {
  const message = {
    from: {
      email: "noreply@wigclub.store",
      name: "Wigclub",
    },
    to: [
      {
        email: params.customerEmail,
        name: params.customer_name,
      },
    ],
    subject: "How was your recent purchase?",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>We'd love to hear from you! ⭐</h2>
        <p>Hello ${params.customer_name},</p>
        <p>Thank you for your recent purchase. We hope you're loving your new item!</p>
        
        <div style="text-align: center; margin: 30px 0; padding: 20px; background-color: #f9f9f9; border-radius: 8px;">
          <img src="${params.product_image_url}" alt="${params.product_name}" style="max-width: 200px; height: auto; border-radius: 5px;">
          <h3 style="margin: 15px 0 5px 0;">${params.product_name}</h3>
        </div>
        
        <p>Your feedback helps us improve and helps other customers make informed decisions. Could you take a moment to share your experience?</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${params.review_url}" style="background-color: #ff6b6b; color: white; padding: 15px 30px; text-decoration: none; border-radius: 25px; display: inline-block; font-weight: bold;">
            Leave a Review ⭐
          </a>
        </div>
        
        <p>Thank you for choosing Wigclub!</p>
        <p>Best regards,<br>The Wigclub Team</p>
      </div>
    `,
    text: `
      We'd love to hear from you!

      Hello ${params.customer_name},

      Thank you for your recent purchase. We hope you're loving your new item!

      Product: ${params.product_name}

      Your feedback helps us improve and helps other customers make informed decisions. Could you take a moment to share your experience?

      Leave a review: ${params.review_url}

      Thank you for choosing Wigclub!

      Best regards,
      The Wigclub Team
    `,
  };

  return await fetch(MAILERSEND_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.MAILERSEND_API_KEY}`,
    },
    body: JSON.stringify(message),
  });
};

export const sendDiscountCodeEmail = async (params: {
  customerEmail: string;
  discountText: string;
  promoCode: string;
  heroImageUrl: string;
  promoCodeEndDate: string;
  promoCodeSpan: "entire-order" | "selected-products";
  bestSellers: Array<{
    image: string;
    name: string;
    original_price: string;
    discounted_price: string;
    product_url: string;
  }>;
  recentlyViewed: Array<{
    image: string;
    name: string;
    original_price: string;
    discounted_price: string;
    product_url: string;
  }>;
}) => {
  // Helper function to chunk arrays into groups of 2 for two-column layout
  type ProductItem = {
    image: string;
    name: string;
    original_price: string;
    discounted_price: string;
    product_url: string;
  };
  const chunkArray = (
    array: ProductItem[],
    chunkSize: number = 2
  ): ProductItem[][] => {
    const chunks: ProductItem[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  };

  // Format expiration date
  const expirationDate = new Date(params.promoCodeEndDate).toLocaleDateString(
    "en-US",
    {
      month: "long",
      day: "numeric",
    }
  );

  const bestSellersHtml = chunkArray(params.bestSellers)
    .map(
      (chunk) => `
    <tr>
      ${chunk
        .map(
          (product) => `
        <td style="width: 50%; padding: 10px;">
          <div style="text-align: center;">
            <img src="${product.image}" alt="${product.name}" style="width: 120px; height: 120px; object-fit: cover; border-radius: 5px;">
            <h4 style="margin: 10px 0 5px 0; font-size: 14px;">${product.name}</h4>
            <p style="margin: 0; color: #666; text-decoration: line-through;">${product.original_price}</p>
            <p style="margin: 0; color: #ff6b6b; font-weight: bold;">${product.discounted_price}</p>
            <a href="${product.product_url}" style="display: inline-block; margin-top: 8px; background-color: #007cba; color: white; padding: 8px 15px; text-decoration: none; border-radius: 3px; font-size: 12px;">Shop Now</a>
          </div>
        </td>
      `
        )
        .join("")}
    </tr>
  `
    )
    .join("");

  const recentlyViewedHtml = chunkArray(params.recentlyViewed)
    .map(
      (chunk) => `
    <tr>
      ${chunk
        .map(
          (product) => `
        <td style="width: 50%; padding: 10px;">
          <div style="text-align: center;">
            <img src="${product.image}" alt="${product.name}" style="width: 120px; height: 120px; object-fit: cover; border-radius: 5px;">
            <h4 style="margin: 10px 0 5px 0; font-size: 14px;">${product.name}</h4>
            <p style="margin: 0; color: #666; text-decoration: line-through;">${product.original_price}</p>
            <p style="margin: 0; color: #ff6b6b; font-weight: bold;">${product.discounted_price}</p>
            <a href="${product.product_url}" style="display: inline-block; margin-top: 8px; background-color: #007cba; color: white; padding: 8px 15px; text-decoration: none; border-radius: 3px; font-size: 12px;">Shop Now</a>
          </div>
        </td>
      `
        )
        .join("")}
    </tr>
  `
    )
    .join("");

  const shopUrl = `${process.env.STORE_URL}/shop/hair`;
  const isEntireOrder = params.promoCodeSpan === "entire-order";

  const message = {
    from: {
      email: "offers@wigclub.store",
      name: "Wigclub",
    },
    to: [
      {
        email: params.customerEmail,
        name: "",
      },
    ],
    subject: `🎉 Exclusive ${params.discountText} Off - Use Code ${params.promoCode}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="text-align: center; margin-bottom: 30px;">
          <img src="${params.heroImageUrl}" alt="Special Offer" style="max-width: 100%; height: auto;">
        </div>
        
        <h1 style="text-align: center; color: #333; font-size: 28px; margin-bottom: 20px;">
          🎉 Exclusive ${params.discountText} Off!
        </h1>
        
        <div style="text-align: center; background-color: #ff6b6b; color: white; padding: 20px; border-radius: 10px; margin: 30px 0;">
          <h2 style="margin: 0; font-size: 24px;">Use Code: ${params.promoCode}</h2>
          <p style="margin: 10px 0 0 0;">
            ${isEntireOrder ? "Valid on your entire order!" : "Valid on selected products!"}
          </p>
          <p style="margin: 5px 0 0 0; font-size: 14px;">Expires ${expirationDate}</p>
        </div>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${shopUrl}" style="background-color: #007cba; color: white; padding: 15px 30px; text-decoration: none; border-radius: 25px; display: inline-block; font-weight: bold; font-size: 18px;">
            Shop Now 🛍️
          </a>
        </div>
        
        ${
          params.bestSellers.length > 0
            ? `
        <h3 style="text-align: center; color: #333; margin: 40px 0 20px 0;">✨ Best Sellers</h3>
        <table style="width: 100%;">
          ${bestSellersHtml}
        </table>
        `
            : ""
        }
        
        ${
          params.recentlyViewed.length > 0
            ? `
        <h3 style="text-align: center; color: #333; margin: 40px 0 20px 0;">👀 Recently Viewed</h3>
        <table style="width: 100%;">
          ${recentlyViewedHtml}
        </table>
        `
            : ""
        }
        
        <div style="margin-top: 40px; text-align: center; color: #666; font-size: 12px;">
          <p>This offer expires on ${expirationDate}. Don't miss out!</p>
          <p>Happy shopping from the Wigclub team! 💕</p>
        </div>
      </div>
    `,
    text: `
      🎉 Exclusive ${params.discountText} Off!

      Use Code: ${params.promoCode}
      ${isEntireOrder ? "Valid on your entire order!" : "Valid on selected products!"}
      Expires: ${expirationDate}

      Shop now: ${shopUrl}

      ${
        params.bestSellers.length > 0
          ? `
      ✨ Best Sellers:
      ${params.bestSellers
        .map(
          (product) =>
            `- ${product.name}: ${product.original_price} → ${product.discounted_price}`
        )
        .join("\n")}
      `
          : ""
      }

      ${
        params.recentlyViewed.length > 0
          ? `
      👀 Recently Viewed:
      ${params.recentlyViewed
        .map(
          (product) =>
            `- ${product.name}: ${product.original_price} → ${product.discounted_price}`
        )
        .join("\n")}
      `
          : ""
      }

      This offer expires on ${expirationDate}. Don't miss out!
      Happy shopping from the Wigclub team! 💕
    `,
  };

  return await fetch(MAILERSEND_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.MAILERSEND_API_KEY}`,
    },
    body: JSON.stringify(message),
  });
};

export const sendDiscountReminderEmail = async (params: {
  customerEmail: string;
  discountText: string;
  promoCode: string;
  heroImageUrl: string;
  bestSellers: Array<{
    image: string;
    name: string;
    original_price: string;
    discounted_price: string;
    product_url: string;
  }>;
  recentlyViewed: Array<{
    image: string;
    name: string;
    original_price: string;
    discounted_price: string;
    product_url: string;
  }>;
}) => {
  // Helper function to chunk arrays into groups of 2 for two-column layout
  type ProductItem = {
    image: string;
    name: string;
    original_price: string;
    discounted_price: string;
    product_url: string;
  };
  const chunkArray = (
    array: ProductItem[],
    chunkSize: number = 2
  ): ProductItem[][] => {
    const chunks: ProductItem[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  };

  const bestSellersHtml = chunkArray(params.bestSellers)
    .map(
      (chunk) => `
    <tr>
      ${chunk
        .map(
          (product) => `
        <td style="width: 50%; padding: 10px;">
          <div style="text-align: center;">
            <img src="${product.image}" alt="${product.name}" style="width: 120px; height: 120px; object-fit: cover; border-radius: 5px;">
            <h4 style="margin: 10px 0 5px 0; font-size: 14px;">${product.name}</h4>
            <p style="margin: 0; color: #666; text-decoration: line-through;">${product.original_price}</p>
            <p style="margin: 0; color: #ff6b6b; font-weight: bold;">${product.discounted_price}</p>
            <a href="${product.product_url}" style="display: inline-block; margin-top: 8px; background-color: #007cba; color: white; padding: 8px 15px; text-decoration: none; border-radius: 3px; font-size: 12px;">Shop Now</a>
          </div>
        </td>
      `
        )
        .join("")}
    </tr>
  `
    )
    .join("");

  const recentlyViewedHtml = chunkArray(params.recentlyViewed)
    .map(
      (chunk) => `
    <tr>
      ${chunk
        .map(
          (product) => `
        <td style="width: 50%; padding: 10px;">
          <div style="text-align: center;">
            <img src="${product.image}" alt="${product.name}" style="width: 120px; height: 120px; object-fit: cover; border-radius: 5px;">
            <h4 style="margin: 10px 0 5px 0; font-size: 14px;">${product.name}</h4>
            <p style="margin: 0; color: #666; text-decoration: line-through;">${product.original_price}</p>
            <p style="margin: 0; color: #ff6b6b; font-weight: bold;">${product.discounted_price}</p>
            <a href="${product.product_url}" style="display: inline-block; margin-top: 8px; background-color: #007cba; color: white; padding: 8px 15px; text-decoration: none; border-radius: 3px; font-size: 12px;">Shop Now</a>
          </div>
        </td>
      `
        )
        .join("")}
    </tr>
  `
    )
    .join("");

  const shopUrl = `${process.env.STORE_URL}/shop/hair`;

  const message = {
    from: {
      email: "offers@test-51ndgwvw8vdlzqx8.mlsender.net",
      name: "Wigclub",
    },
    to: [
      {
        email: params.customerEmail,
        name: "",
      },
    ],
    subject: `⏰ Last Chance! Your ${params.discountText} Discount Expires Soon`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="text-align: center; margin-bottom: 30px;">
          <img src="${params.heroImageUrl}" alt="Last Chance Offer" style="max-width: 100%; height: auto;">
        </div>
        
        <h1 style="text-align: center; color: #ff6b6b; font-size: 28px; margin-bottom: 20px;">
          ⏰ Last Chance!
        </h1>
        
        <p style="text-align: center; font-size: 18px; color: #333; margin-bottom: 30px;">
          Your ${params.discountText} discount expires on July 20!
        </p>
        
        <div style="text-align: center; background-color: #ff6b6b; color: white; padding: 20px; border-radius: 10px; margin: 30px 0;">
          <h2 style="margin: 0; font-size: 24px;">Use Code: ${params.promoCode}</h2>
          <p style="margin: 10px 0 0 0; font-size: 16px;">Don't let this deal slip away!</p>
        </div>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${shopUrl}" style="background-color: #007cba; color: white; padding: 15px 30px; text-decoration: none; border-radius: 25px; display: inline-block; font-weight: bold; font-size: 18px;">
            Shop Now Before It's Gone! 🏃‍♀️
          </a>
        </div>
        
        ${
          params.bestSellers.length > 0
            ? `
        <h3 style="text-align: center; color: #333; margin: 40px 0 20px 0;">✨ Best Sellers</h3>
        <table style="width: 100%;">
          ${bestSellersHtml}
        </table>
        `
            : ""
        }
        
        ${
          params.recentlyViewed.length > 0
            ? `
        <h3 style="text-align: center; color: #333; margin: 40px 0 20px 0;">👀 Recently Viewed</h3>
        <table style="width: 100%;">
          ${recentlyViewedHtml}
        </table>
        `
            : ""
        }
        
        <div style="margin-top: 40px; text-align: center; color: #666; font-size: 14px; background-color: #fff3cd; padding: 15px; border-radius: 5px; border-left: 4px solid #ffc107;">
          <p style="margin: 0; font-weight: bold; color: #856404;">⚠️ Hurry! This offer expires on July 20</p>
          <p style="margin: 5px 0 0 0; color: #856404;">Once it's gone, it's gone!</p>
        </div>
        
        <p style="text-align: center; margin-top: 30px; color: #666;">
          Happy shopping from the Wigclub team! 💕
        </p>
      </div>
    `,
    text: `
      ⏰ Last Chance!

      Your ${params.discountText} discount expires on July 20!

      Use Code: ${params.promoCode}
      Don't let this deal slip away!

      Shop now: ${shopUrl}

      ${
        params.bestSellers.length > 0
          ? `
      ✨ Best Sellers:
      ${params.bestSellers
        .map(
          (product) =>
            `- ${product.name}: ${product.original_price} → ${product.discounted_price}`
        )
        .join("\n")}
      `
          : ""
      }

      ${
        params.recentlyViewed.length > 0
          ? `
      👀 Recently Viewed:
      ${params.recentlyViewed
        .map(
          (product) =>
            `- ${product.name}: ${product.original_price} → ${product.discounted_price}`
        )
        .join("\n")}
      `
          : ""
      }

      ⚠️ Hurry! This offer expires on July 20
      Once it's gone, it's gone!

      Happy shopping from the Wigclub team! 💕
    `,
  };

  return await fetch(MAILERSEND_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.MAILERSEND_API_KEY}`,
    },
    body: JSON.stringify(message),
  });
};
