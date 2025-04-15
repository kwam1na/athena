import config from "@/config";
import { Guest } from "@athena/webapp";

export async function updateGuest({
  data,
}: {
  data: Partial<Guest>;
}): Promise<Guest> {
  const response = await fetch(`${config.apiGateway.URL}/guests`, {
    method: "PUT",
    body: JSON.stringify(data),
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error updating guest.");
  }

  return res;
}
