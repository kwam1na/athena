import config from "@/config";

const getBaseUrl = () => `${config.apiGateway.URL}/upsells`;

export async function getLastViewedProduct(opts?: {
  category?: string;
  minAgeHours?: number;
}) {
  const params = new URLSearchParams();
  if (opts?.category) params.set("category", opts.category);
  if (typeof opts?.minAgeHours === "number")
    params.set("minAgeHours", String(opts.minAgeHours));
  const qs = params.toString();
  const url = qs ? `${getBaseUrl()}?${qs}` : getBaseUrl();
  const response = await fetch(url, {
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading last viewed product.");
  }

  return res;
}
