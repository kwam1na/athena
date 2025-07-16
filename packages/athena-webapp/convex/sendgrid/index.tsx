import { capitalizeWords } from "../utils";

export const sendVerificationCode = async (params: {
  customerEmail: string;
  verificationCode: string;
  storeName?: string;
  validTime: string;
}) => {
  const message = {
    from: {
      email: "noreply@wigclub.store",
      name: params.storeName && capitalizeWords(params.storeName),
    },
    personalizations: [
      {
        to: [
          {
            email: params.customerEmail,
          },
        ],
        dynamic_template_data: {
          store_name: params.storeName,
          verification_code: params.verificationCode,
          valid_time: params.validTime,
        },
      },
    ],
    template_id: "d-4738388ab3f440febf5bfc7e7c31b644",
  };

  return await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
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
  const templateId = {
    confirmation: "d-be37af6e090c4273ad0b20d5a3dd1162",
    ready: "d-b210f1543144426d89525df6b3983fe7",
    complete: "d-b210f1543144426d89525df6b3983fe7",
    canceled: "d-b210f1543144426d89525df6b3983fe7",
  };

  const message = {
    from: {
      email: "orders@wigclub.store",
      name: capitalizeWords(params.store_name),
    },
    personalizations: [
      {
        to: [
          {
            email: params.customerEmail,
          },
        ],
        dynamic_template_data: {
          delivery_fee: params.delivery_fee,
          customer_name: params.customer_name.toUpperCase(),
          discount: params.discount,
          store_name: params.store_name,
          order_number: params.order_number,
          order_date: params.order_date,
          order_status_messaging: params.order_status_messaging,
          total: params.total,
          items: params.items,
          pickup_type: capitalizeWords(params.pickup_type),
          pickup_details: params.pickup_details,
          receipt: true,
          Sender_Name: "Wigclub",
          Sender_Address: "2 Jungle Avenue, East Legon",
          Sender_City: "Accra",
          Sender_State: "Ghana",
        },
      },
    ],
    template_id: templateId[params.type],
  };

  return await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
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

  const message = {
    from: {
      email: "orders@wigclub.store",
      name: capitalizeWords(params.store_name),
    },
    personalizations: [
      {
        to: [
          {
            email: "essuahmensahmaud@gmail.com",
          },
          {
            email: "kwamina.0x00@gmail.com",
          },
        ],
        dynamic_template_data: {
          order_amount: params.order_amount,
          order_status: params.order_status,
          order_date: params.order_date,
          customer_name: params.customer_name,
          order_url: `${appUrl}/wigclub/store/wigclub/orders/${params.order_id}`,
        },
      },
    ],
    template_id: "d-46cad01ea7a141d38c97d948ac0e655a",
  };

  return await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
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
    personalizations: [
      {
        to: [
          {
            email: params.customerEmail,
          },
        ],
        dynamic_template_data: {
          customer_name: params.customer_name,
          product_name: params.product_name,
          product_image_url: params.product_image_url,
          review_url: params.review_url,
        },
      },
    ],
    template_id: "d-95899bf9e0cd4fe09593cd4df8e6e087",
  };

  return await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
    },
    body: JSON.stringify(message),
  });
};

export const sendDiscountCodeEmail = async (params: {
  customerEmail: string;
  promoCode: string;
  discount: string;
  validTo: Date;
}) => {
  // Format expiration date
  const expirationDate = new Date(
    Date.now() + 1 * 24 * 60 * 60 * 1000
  ).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const message = {
    from: {
      email: "offers@wigclub.store",
      name: "Wigclub",
    },
    personalizations: [
      {
        to: [
          {
            email: params.customerEmail,
          },
        ],
        dynamic_template_data: {
          promo_code: params.promoCode,
          discount: params.discount,
          expiration_date: expirationDate,
          shop_url: `${process.env.STORE_URL}/shop/hair`,
        },
      },
    ],
    template_id: "d-c5615c89ab4043b680c184d11eaa12a4",
  };

  return await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
    },
    body: JSON.stringify(message),
  });
};
