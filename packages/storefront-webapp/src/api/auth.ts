import config from "@/config";

export async function verifyUserAccount({
  email,
  code,
  firstName,
  lastName,
}: {
  email?: string;
  code?: string;
  firstName?: string;
  lastName?: string;
}) {
  const response = await fetch(`${config.apiGateway.URL}/auth/verify`, {
    method: "POST",
    body: JSON.stringify({ email, code, firstName, lastName }),
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error verifying account.");
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
