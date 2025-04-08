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
}) => {
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
    template_id: "d-b210f1543144426d89525df6b3983fe7",
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
}) => {
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
