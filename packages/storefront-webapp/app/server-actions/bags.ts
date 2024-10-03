import { bagRepository, guestsRepository, storeRepository } from "@athena/db";
import { createServerFn } from "@tanstack/start";
import { getCookie, setCookie } from "vinxi/http";

export const getBag = createServerFn("GET", async () => {
  const customerId = getCookie("athena-customer-id");
  const guestId = getCookie("athena-guest-id");

  const id = customerId || guestId;

  if (id) {
    const bag = await bagRepository.getByCustomerId(parseInt(id));

    if (!bag) {
      return await bagRepository.create(parseInt(id));
    }

    return bag;
  }

  const guest = await guestsRepository.create();

  setCookie("athena-guest-id", guest.id.toString(), {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
  });

  return await bagRepository.create(guest.id);
});
