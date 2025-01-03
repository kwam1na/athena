export const sendVerificationCode = async (params: {
  customerEmail: string;
  verificationCode: string;
  storeName?: string;
  validTime: string;
}) => {
  const message = {
    from: {
      email: "noreply@wigclub.store",
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
    },
    body: JSON.stringify(message),
  });
};
