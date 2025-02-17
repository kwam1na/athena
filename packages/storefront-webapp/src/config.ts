const config = {
  apiGateway: {
    URL:
      import.meta.env.VITE_API_URL ||
      "https://jovial-wildebeest-179.convex.site",
  },
  hlsURL:
    import.meta.env.VITE_HLS_URL || "https://d1sjmzps5tlpbc.cloudfront.net",
  storefront: {
    storeName: "Wigclub",
  },
};

export default config;
