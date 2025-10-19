import { render } from "@react-email/components";
import { capitalizeWords } from "../utils";
import VerificationCode from "../emails/VerificationCode";
import OrderEmail from "../emails/OrderEmail";
import NewOrderAdmin from "../emails/NewOrderAdmin";
import FeedbackRequest from "../emails/FeedbackRequest";
import DiscountCode from "../emails/DiscountCode";
import DiscountReminder from "../emails/DiscountReminder";

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

  const html = render(
    <VerificationCode
      customerEmail={params.customerEmail}
      verificationCode={params.verificationCode}
      storeName={storeName}
      validTime={params.validTime}
    />
  );

  const text = render(
    <VerificationCode
      customerEmail={params.customerEmail}
      verificationCode={params.verificationCode}
      storeName={storeName}
      validTime={params.validTime}
    />,
    { plainText: true }
  );

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
    html,
    text,
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
  subtotal: string;
  delivery_fee?: string;
  discount?: string;
  items: Array<{
    text: string;
    image: string;
    price: string;
    discountedPrice?: string;
    savings?: string;
    quantity: string;
    length?: string;
    color: string;
  }>;
  pickup_type: string;
  pickup_details: string;
  customer_name: string;
}) => {
  const html = await render(
    <OrderEmail
      type={params.type}
      customerEmail={params.customerEmail}
      store_name={params.store_name}
      order_number={params.order_number}
      order_date={params.order_date}
      order_status_messaging={params.order_status_messaging}
      total={params.total}
      subtotal={params.subtotal}
      delivery_fee={params.delivery_fee}
      discount={params.discount}
      items={params.items}
      pickup_type={params.pickup_type}
      pickup_details={params.pickup_details}
      customer_name={params.customer_name}
    />
  );

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
    html,
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

  const html = await render(
    <NewOrderAdmin
      store_name={params.store_name}
      order_amount={params.order_amount}
      order_status={params.order_status}
      order_date={params.order_date}
      customer_name={params.customer_name}
      order_id={params.order_id}
      appUrl={orderUrl}
    />
  );

  const message = {
    from: {
      email: "orders@wigclub.store",
      name: capitalizeWords(params.store_name),
    },
    to: [
      // {
      //   email: "essuahmensahmaud@gmail.com",
      //   name: "Admin",
      // },
      {
        email: "kwamina.0x00@gmail.com",
        name: "Admin",
      },
    ],
    subject: "🎉 New Order Received!",
    html,
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
  const html = await render(
    <FeedbackRequest
      customerEmail={params.customerEmail}
      customer_name={params.customer_name}
      product_name={params.product_name}
      product_image_url={params.product_image_url}
      review_url={params.review_url}
    />
  );

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
    html,
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
  const shopUrl = `${process.env.STORE_URL}/shop/hair`;

  const html = await render(
    <DiscountCode
      customerEmail={params.customerEmail}
      discountText={params.discountText}
      promoCode={params.promoCode}
      heroImageUrl={params.heroImageUrl}
      promoCodeEndDate={params.promoCodeEndDate}
      promoCodeSpan={params.promoCodeSpan}
      bestSellers={params.bestSellers}
      recentlyViewed={params.recentlyViewed}
      shopUrl={shopUrl}
    />
  );

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
    html,
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
  const shopUrl = `${process.env.STORE_URL}/shop/hair`;

  const html = await render(
    <DiscountReminder
      customerEmail={params.customerEmail}
      discountText={params.discountText}
      promoCode={params.promoCode}
      heroImageUrl={params.heroImageUrl}
      bestSellers={params.bestSellers}
      recentlyViewed={params.recentlyViewed}
      shopUrl={shopUrl}
    />
  );

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
    html,
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
