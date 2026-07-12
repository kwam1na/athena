import { render } from "@react-email/components";
import { describe, expect, it } from "vitest";
import WalkthroughRequestNotification from "./WalkthroughRequestNotification";

describe("WalkthroughRequestNotification", () => {
  it("escapes markup and de-links untrusted URLs", async () => {
    const html = await render(
      WalkthroughRequestNotification({
        requestId: "request-1",
        name: "Ada Owner",
        workEmail: "ada@example.com",
        businessName: "Ada Goods",
        businessNeed: '<script>alert(1)</script> Review https://evil.example/path and evil.example.',
      }),
    );

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("https://evil.example");
    expect(html).not.toContain("evil.example");
    expect(html).not.toMatch(/href=["']https?:\/\/evil/i);
    expect(html).toContain("evil[.]example");
  });
});
