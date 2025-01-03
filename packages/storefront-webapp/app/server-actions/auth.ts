import { createGuest, getActiveUser } from "@/api/guest";
import { verifyUserAccount } from "@/api/stores";
import { useAppSession } from "@/utils/session";
import { createServerFn } from "@tanstack/start";
import { getCookie, setCookie } from "vinxi/http";

export const logIn = createServerFn("POST", (data?: Record<string, any>) => {
  return { success: true };
});

export const fetchUser = createServerFn(
  "GET",
  async (params: { organizationId: string; storeId: string }, ctx) => {
    let guestId = getCookie("athena-guest-id");

    const userId = getCookie("athena-storefront-user-id");

    if (!userId && !guestId) {
      const newGuest = await createGuest(params.organizationId, params.storeId);

      setCookie("athena-guest-id", newGuest.id.toString(), {
        httpOnly: true,
        secure: true,
        sameSite: "none",
      });

      guestId = newGuest.id;
    }

    return {
      userId,
      guestId,
    };
  }
);

export const loginFn = createServerFn(
  "POST",
  async (payload: {
    email?: string;
    organizationId: string;
    storeId: string;
    code?: string;
  }) => {
    const res = await verifyUserAccount({
      organizationId: payload.organizationId,
      storeId: payload.storeId,
      email: payload.email,
      code: payload.code,
    });

    if (res.accessToken && res.refreshToken) {
      setCookie("athena-access-token", res.accessToken, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        maxAge: 900, // 7 days
      });

      setCookie("athena-refresh-token", res.refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        maxAge: 604800, // 7 days
      });
    }

    if (res.user) {
      setCookie("athena-storefront-user-id", res.user._id, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        maxAge: 604800, // 7 days, matching refresh token
      });
    }

    return res;
  }
);

export const logoutFn = createServerFn("POST", async () => {
  // delete cookies
  setCookie("athena-access-token", "", {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    maxAge: 0,
  });

  setCookie("athena-refresh-token", "", {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    maxAge: 0,
  });

  setCookie("athena-storefront-user-id", "", {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    maxAge: 0,
  });
});
