import { beforeEach, describe, expect, it, vi } from "vitest";

const mockedMailerSend = vi.hoisted(() => ({
  sendVerificationCode: vi.fn(),
}));

vi.mock("../mailersend", () => ({
  sendVerificationCode: mockedMailerSend.sendVerificationCode,
}));

import { EmailOTP } from "./EmailOTP";
import { ATHENA_LOGIN_EMAIL_NOT_APPROVED_ERROR_CODE } from "../../shared/auth";

describe("EmailOTP", () => {
  beforeEach(() => {
    mockedMailerSend.sendVerificationCode.mockReset();
    vi.useRealTimers();
  });

  it("sends login codes through MailerSend with the remaining validity window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T01:00:00.000Z"));

    mockedMailerSend.sendVerificationCode.mockResolvedValue({
      ok: true,
    });

    await EmailOTP.sendVerificationRequest({
      identifier: "kwami.nuh@gmail.com",
      token: "123456",
      expires: new Date("2026-04-22T01:20:00.000Z"),
      provider: EmailOTP,
      request: new Request("http://localhost"),
      theme: {},
    } as never);

    expect(mockedMailerSend.sendVerificationCode).toHaveBeenCalledWith({
      customerEmail: "kwami.nuh@gmail.com",
      verificationCode: "123456",
      storeName: "Athena",
      validTime: "20 minutes",
    });
  });

  it("silently withholds login codes from unapproved addresses", async () => {
    await EmailOTP.sendVerificationRequest({
      identifier: "unapproved@example.com",
      token: "123456",
      expires: new Date("2026-04-22T01:20:00.000Z"),
      provider: EmailOTP,
      request: new Request("http://localhost"),
      theme: {},
    } as never);

    expect(mockedMailerSend.sendVerificationCode).not.toHaveBeenCalled();
  });

  it("rechecks approval when a login code is verified", async () => {
    await expect(
      EmailOTP.authorize?.(
        { email: "unapproved@example.com" },
        { providerAccountId: "unapproved@example.com" } as never,
      ),
    ).rejects.toThrow(ATHENA_LOGIN_EMAIL_NOT_APPROVED_ERROR_CODE);
  });

  it("surfaces MailerSend failures from the shared email transport", async () => {
    mockedMailerSend.sendVerificationCode.mockResolvedValue(
      new Response("mailersend boom", { status: 500 })
    );

    await expect(
      EmailOTP.sendVerificationRequest({
        identifier: "kwamina.0x00@gmail.com",
        token: "123456",
        expires: new Date("2026-04-22T01:20:00.000Z"),
        provider: EmailOTP,
        request: new Request("http://localhost"),
        theme: {},
      } as never)
    ).rejects.toThrow("mailersend boom");
  });
});
