const config = {
  storeFrontUrl: import.meta.env.VITE_STOREFRONT_URL || "http://localhost:5174",
  hlsURL:
    import.meta.env.VITE_HLS_URL || "https://d1sjmzps5tlpbc.cloudfront.net",
};

export default config;
