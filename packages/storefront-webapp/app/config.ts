const config = {
  // Frontend config
  MAX_ATTACHMENT_SIZE: 5000000,
  STRIPE_KEY:
    "pk_test_51PrT6mRxIMGeFmUIi4qx5BXhf5azPOaYwDcvx9rE8zK9CuIl8KuxPpdBW5lYFtNPaWZ5XLFd14Fq7dFK3D8MXHmt00xLr0Bevj",
  // Backend config
  aws: {
    ACCESS: import.meta.env.VITE_AWS_ACCESS,
    SECRET: import.meta.env.VITE_AWS_SECRET,
  },
  s3: {
    REGION: import.meta.env.VITE_AWS_REGION,
    BUCKET: import.meta.env.VITE_S3_BUCKET,
    BUCKET_DOMAIN: import.meta.env.VITE_S3_BUCKET_DOMAIN,
  },
  apiGateway: {
    REGION: import.meta.env.VITE_REGION,
    // URL: import.meta.env.VITE_API_URL,
    URL: "http://localhost:4000",
  },
  cognito: {
    REGION: import.meta.env.VITE_REGION,
    USER_POOL_ID: import.meta.env.VITE_USER_POOL_ID,
    APP_CLIENT_ID: import.meta.env.VITE_USER_POOL_CLIENT_ID,
    IDENTITY_POOL_ID: import.meta.env.VITE_IDENTITY_POOL_ID,
  },
};

export default config;
