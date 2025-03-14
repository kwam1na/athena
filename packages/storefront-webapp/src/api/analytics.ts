import config from "@/config";

export async function postAnalytics({
  action,
  origin,
  data,
}: {
  action: string;
  origin?: string;
  data: Record<string, any>;
}) {
  const response = await fetch(`${config.apiGateway.URL}/analytics`, {
    method: "POST",
    body: JSON.stringify({ action, origin, data }),
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error posting analytics.");
  }

  return res;
}

export async function logout() {
  const response = await fetch(`${config.apiGateway.URL}/auth/logout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error logging out.");
  }

  return res;
}
