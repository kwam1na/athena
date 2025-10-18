import config from "@/config";
import { BannerMessage } from "@athena/webapp";

export async function getBannerMessage(): Promise<BannerMessage | null> {
  const response = await fetch(`${config.apiGateway.URL}/banner-message`, {
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading banner message.");
  }

  return res.bannerMessage;
}
