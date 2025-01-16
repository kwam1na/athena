import { createGuest } from "@/api/storeFrontUser";
import { verifyUserAccount } from "@/api/stores";
import { createServerFn } from "@tanstack/start";
import { getCookie, setCookie } from "vinxi/http";

// export const fetchUser = createServerFn(
//   "GET",
//   async (params: { organizationId: string; storeId: string }, ctx) => {
//     let guestId = getCookie("athena-guest-id");

//     const userId = getCookie("athena-storefront-user-id");

//     if (!userId && !guestId) {
//       console.info("no user id or guest id found, creating guest");
//       const newGuest = await createGuest(params.organizationId, params.storeId);

//       setCookie("athena-guest-id", newGuest.id.toString(), {
//         httpOnly: true,
//         secure: true,
//         sameSite: "none",
//       });

//       guestId = newGuest.id;
//     }

//     return {
//       userId,
//       guestId,
//     };
//   }
// );



export const fetchUser = createServerFn({method: 'POST'}).handler(async ({ data }) => {
  console.log(data)
});






// export const loginFn = createServerFn(
//   "POST",
//   async (payload: {
//     email?: string;
//     organizationId: string;
//     storeId: string;
//     code?: string;
//   }) => {
//     const res = await verifyUserAccount({
//       organizationId: payload.organizationId,
//       storeId: payload.storeId,
//       email: payload.email,
//       code: payload.code,
//     });

//     if (res.accessToken && res.refreshToken) {
//       setCookie("athena-access-token", res.accessToken, {
//         httpOnly: true,
//         secure: true,
//         sameSite: "none",
//         maxAge: 900, // 7 days
//       });

//       setCookie("athena-refresh-token", res.refreshToken, {
//         httpOnly: true,
//         secure: true,
//         sameSite: "none",
//         maxAge: 604800, // 7 days
//       });
//     }

//     if (res.user) {
//       setCookie("athena-storefront-user-id", res.user._id, {
//         httpOnly: true,
//         secure: true,
//         sameSite: "none",
//         maxAge: 604800, // 7 days, matching refresh token
//       });
//     }

//     return res;
//   }
// );

// export const logoutFn = createServerFn("POST", async () => {
//   // delete cookies
//   setCookie("athena-access-token", "", {
//     httpOnly: true,
//     secure: true,
//     sameSite: "none",
//     maxAge: 0,
//   });

//   setCookie("athena-refresh-token", "", {
//     httpOnly: true,
//     secure: true,
//     sameSite: "none",
//     maxAge: 0,
//   });

//   setCookie("athena-storefront-user-id", "", {
//     httpOnly: true,
//     secure: true,
//     sameSite: "none",
//     maxAge: 0,
//   });
// });


export const logoutFn = createServerFn({method: 'POST'}).handler(async ({ data }) => {
  console.log(data)
});


export const loginFn = createServerFn({method: 'POST'}).handler(async ({ data }) => {
  console.log(data)
});