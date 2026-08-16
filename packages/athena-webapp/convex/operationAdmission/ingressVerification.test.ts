import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A verifier denies when its secret is absent, which is correct — an
 * unauthenticated webhook endpoint is not a fallback anyone accepts. But the
 * caller sees the same flat 403 either way, so without a log an operator
 * cannot tell "nobody set `PAYSTACK_SECRET_KEY`" from "someone is probing us",
 * and a misconfigured deploy rejects every payment callback forever in silence.
 *
 * These tests pin both halves of the rule:
 *   - a MISSING SECRET logs, once, naming the variable and nothing else;
 *   - a BAD SIGNATURE denies in silence, because it is attacker-controlled and
 *     logging it hands an unauthenticated caller a log-volume lever.
 *
 * Each test re-imports the module so the once-per-isolate log memory starts
 * empty; that memory is deliberately not exposed as a production reset.
 */
async function freshModule() {
  vi.resetModules();
  return import("./ingressVerification");
}

function input(rawBody: string, headers: Record<string, string>) {
  return {
    headers: new Headers(headers),
    rawBody,
    request: new Request("https://athena.example/webhook"),
  };
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("missing verifier configuration", () => {
  it("denies and reports an unset Paystack secret exactly once", async () => {
    const { createPaystackSignatureVerifier, PAYSTACK_SECRET_ENV } =
      await freshModule();
    const verify = createPaystackSignatureVerifier({});
    const request = input("{}", { "x-paystack-signature": "deadbeef" });

    await expect(verify(request)).resolves.toBe(false);
    await expect(verify(request)).resolves.toBe(false);
    await expect(verify(request)).resolves.toBe(false);

    // Repeating the same line on every webhook buries the signal it exists to
    // raise, so the report is deduplicated per variable.
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(String(consoleError.mock.calls[0][0])).toContain(
      PAYSTACK_SECRET_ENV,
    );
  });

  it("treats an empty secret as unset", async () => {
    const { createPaystackSignatureVerifier, PAYSTACK_SECRET_ENV } =
      await freshModule();

    await expect(
      createPaystackSignatureVerifier({ [PAYSTACK_SECRET_ENV]: "" })(
        input("{}", { "x-paystack-signature": "deadbeef" }),
      ),
    ).resolves.toBe(false);

    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it("reports each missing variable separately", async () => {
    const {
      createPaystackSignatureVerifier,
      createWhatsAppSignatureVerifier,
      createMtnMomoCallbackVerifier,
      createHarnessWaiverBrokerVerifier,
      PAYSTACK_SECRET_ENV,
      WHATSAPP_APP_SECRET_ENV,
      MTN_MOMO_CALLBACK_SECRET_ENV,
      HARNESS_WAIVER_BROKER_SECRET_ENV,
    } = await freshModule();

    await createPaystackSignatureVerifier({})(input("{}", {}));
    await createWhatsAppSignatureVerifier({})(input("{}", {}));
    await createMtnMomoCallbackVerifier({})(input("{}", {}));
    await createHarnessWaiverBrokerVerifier({})(input("", {}));

    const reported = consoleError.mock.calls.map((call) => String(call[0]));
    expect(reported).toHaveLength(4);
    for (const variable of [
      PAYSTACK_SECRET_ENV,
      WHATSAPP_APP_SECRET_ENV,
      MTN_MOMO_CALLBACK_SECRET_ENV,
      HARNESS_WAIVER_BROKER_SECRET_ENV,
    ]) {
      expect(reported.some((line) => line.includes(variable))).toBe(true);
    }
  });

  it("reports a marketing origin list that cannot be resolved", async () => {
    const { createMarketingOriginVerifier, MARKETING_ALLOWED_ORIGINS_ENV } =
      await freshModule();
    const verify = createMarketingOriginVerifier(() => {
      throw new Error("WALKTHROUGH_ALLOWED_ORIGINS is malformed");
    });
    const request = input("", { Origin: "https://athena.example" });

    expect(await verify(request)).toBe(false);
    expect(await verify(request)).toBe(false);

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(String(consoleError.mock.calls[0][0])).toContain(
      MARKETING_ALLOWED_ORIGINS_ENV,
    );
  });
});

describe("configured verifiers", () => {
  it("denies a forged signature without logging", async () => {
    const { createPaystackSignatureVerifier, PAYSTACK_SECRET_ENV } =
      await freshModule();
    const verify = createPaystackSignatureVerifier({
      [PAYSTACK_SECRET_ENV]: "sk_test",
    });

    // Wrong digest, and no digest at all: both are expected denials at a
    // boundary that is working, and neither is an operator's problem.
    await expect(
      verify(input("{}", { "x-paystack-signature": "deadbeef" })),
    ).resolves.toBe(false);
    await expect(verify(input("{}", {}))).resolves.toBe(false);

    expect(consoleError).not.toHaveBeenCalled();
  });

  it("denies a forged secret on the other env-backed verifiers silently", async () => {
    const {
      createWhatsAppSignatureVerifier,
      createMtnMomoCallbackVerifier,
      createHarnessWaiverBrokerVerifier,
      WHATSAPP_APP_SECRET_ENV,
      MTN_MOMO_CALLBACK_SECRET_ENV,
      HARNESS_WAIVER_BROKER_SECRET_ENV,
    } = await freshModule();

    // The MTN and broker verifiers are synchronous, so each result is awaited
    // rather than asserted as a promise.
    expect(
      await createWhatsAppSignatureVerifier({
        [WHATSAPP_APP_SECRET_ENV]: "app-secret",
      })(input("{}", { "x-hub-signature-256": "sha256=deadbeef" })),
    ).toBe(false);
    expect(
      await createMtnMomoCallbackVerifier({
        [MTN_MOMO_CALLBACK_SECRET_ENV]: "callback-secret",
      })(input("{}", { "x-callback-secret": "wrong-secret" })),
    ).toBe(false);
    expect(
      await createHarnessWaiverBrokerVerifier({
        [HARNESS_WAIVER_BROKER_SECRET_ENV]: "broker-secret",
      })(input("", { authorization: "Bearer wrong" })),
    ).toBe(false);

    expect(consoleError).not.toHaveBeenCalled();
  });

  it("never puts the secret or the presented signature in the report", async () => {
    const { createPaystackSignatureVerifier } = await freshModule();

    await createPaystackSignatureVerifier({})(
      input('{"event":"charge.success"}', {
        "x-paystack-signature": "presented-signature-value",
      }),
    );

    const reported = String(consoleError.mock.calls[0][0]);
    expect(reported).not.toContain("presented-signature-value");
    expect(reported).not.toContain("charge.success");
  });
});
