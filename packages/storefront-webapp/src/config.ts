const config = {
  apiGateway: {
    URL:
      import.meta.env.VITE_API_URL ||
      "https://jovial-wildebeest-179.convex.site",
  },
  storefront: {
    storeName: "Wigclub",
  },
};

export default config;
