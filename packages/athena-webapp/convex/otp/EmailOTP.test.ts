import { beforeEach, describe, expect, it, vi } from "vitest";

const mockedMailerSend = vi.hoisted(() => ({
  sendVerificationCode: vi.fn(),
}));

vi.mock("../mailersend", () => ({
  sendVerificationCode: mockedMailerSend.sendVerificationCode,
}));

import { EmailOTP } from "./EmailOTP";

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
      identifier: "manager@example.com",
      token: "123456",
      expires: new Date("2026-04-22T01:20:00.000Z"),
      provider: EmailOTP,
      request: new Request("http://localhost"),
      theme: {},
    } as never);

    expect(mockedMailerSend.sendVerificationCode).toHaveBeenCalledWith({
      customerEmail: "manager@example.com",
      verificationCode: "123456",
      storeName: "Athena",
      validTime: "20 minutes",
    });
  });

  it("surfaces MailerSend failures from the shared email transport", async () => {
    mockedMailerSend.sendVerificationCode.mockResolvedValue(
      new Response("mailersend boom", { status: 500 })
    );

    await expect(
      EmailOTP.sendVerificationRequest({
        identifier: "manager@example.com",
        token: "123456",
        expires: new Date("2026-04-22T01:20:00.000Z"),
        provider: EmailOTP,
        request: new Request("http://localhost"),
        theme: {},
      } as never)
    ).rejects.toThrow("mailersend boom");
  });
});
