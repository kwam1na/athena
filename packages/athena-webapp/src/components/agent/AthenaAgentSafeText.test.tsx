import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AthenaAgentSafeText } from "./AthenaAgentSafeText";

type NetworkSpy = ReturnType<typeof vi.fn<() => void>>;

type NetworkSpies = {
  fetch: NetworkSpy;
  open: NetworkSpy;
  image: NetworkSpy;
  beacon: NetworkSpy;
};

let network: NetworkSpies;
const originals: Record<string, unknown> = {};

beforeEach(() => {
  network = {
    fetch: vi.fn<() => void>(),
    open: vi.fn<() => void>(),
    image: vi.fn<() => void>(),
    beacon: vi.fn<() => void>(),
  };
  originals.fetch = window.fetch;
  originals.open = window.XMLHttpRequest.prototype.open;
  originals.image = window.Image;
  originals.beacon = navigator.sendBeacon;
  window.fetch = network.fetch as unknown as typeof window.fetch;
  window.XMLHttpRequest.prototype.open =
    network.open as unknown as XMLHttpRequest["open"];
  class SpyImage {
    constructor() {
      network.image();
    }
  }
  window.Image = SpyImage as unknown as typeof window.Image;
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    value: network.beacon,
  });
});

afterEach(() => {
  window.fetch = originals.fetch as typeof window.fetch;
  window.XMLHttpRequest.prototype.open =
    originals.open as XMLHttpRequest["open"];
  window.Image = originals.image as typeof window.Image;
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    value: originals.beacon,
  });
});

function expectNoNetworkRequest() {
  expect(network.fetch).not.toHaveBeenCalled();
  expect(network.open).not.toHaveBeenCalled();
  expect(network.image).not.toHaveBeenCalled();
  expect(network.beacon).not.toHaveBeenCalled();
}

function expectNoActiveElements(container: HTMLElement) {
  for (const selector of [
    "a",
    "img",
    "iframe",
    "script",
    "style",
    "link",
    "object",
    "embed",
    "video",
    "audio",
    "form",
    "input",
    "svg",
    "picture",
    "source",
  ]) {
    expect(container.querySelector(selector)).toBeNull();
  }
  // "onerror" and "javascript:" may legitimately appear as visible characters;
  // what must never happen is either becoming an attribute.
  for (const element of Array.from(container.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      expect(attribute.name).not.toMatch(/^on/i);
      expect(["href", "src", "srcset", "data", "action", "formaction"]).not.toContain(
        attribute.name,
      );
    }
  }
}

describe("Athena answer rendering treats the narrative as untrusted", () => {
  it("renders a stored script payload as text and runs nothing", () => {
    const alerted = vi.fn();
    (window as unknown as { __athenaXss?: () => void }).__athenaXss = alerted;

    const { container } = render(
      <AthenaAgentSafeText
        text={'<script>window.__athenaXss()</script>\n\n<img src="x" onerror="window.__athenaXss()">'}
      />,
    );

    expect(alerted).not.toHaveBeenCalled();
    expect(container.textContent).toContain("<script>");
    expectNoActiveElements(container);
    expectNoNetworkRequest();
  });

  it("renders raw HTML markup, CSS resources, and embeds as inert text", () => {
    const { container } = render(
      <AthenaAgentSafeText
        text={[
          '<b onclick="steal()">bold</b>',
          '<style>@import url("https://evil.example/x.css");</style>',
          '<link rel="stylesheet" href="https://evil.example/x.css">',
          '<iframe src="https://evil.example/frame"></iframe>',
          '<object data="https://evil.example/o"></object>',
          '<embed src="https://evil.example/e">',
          '<video src="https://evil.example/v.mp4"></video>',
        ].join("\n\n")}
      />,
    );

    expect(container.textContent).toContain("<b onclick=");
    expect(container.textContent).toContain("https://evil.example/frame");
    expectNoActiveElements(container);
    expectNoNetworkRequest();
  });

  it("renders remote images and previews as text without requesting them", () => {
    const { container } = render(
      <AthenaAgentSafeText
        text={"![receipt](https://evil.example/pixel.png)\n\nSee https://evil.example/preview for more."}
      />,
    );

    expect(container.textContent).toContain("https://evil.example/pixel.png");
    expectNoActiveElements(container);
    expectNoNetworkRequest();
  });

  it("leaves autolinks, unsafe protocols, and encoded URLs as plain text", () => {
    const { container } = render(
      <AthenaAgentSafeText
        text={[
          "Bare: https://evil.example/bare",
          "Angle: <https://evil.example/angle>",
          "Unsafe: [click](javascript:window.__athenaXss())",
          "Data: [open](data:text/html;base64,PHNjcmlwdD4=)",
          "Encoded: [go](%6a%61%76%61%73%63%72%69%70%74:alert(1))",
          "Mailto: <mailto:ops@example.com>",
        ].join("\n\n")}
      />,
    );

    expect(container.textContent).toContain("https://evil.example/bare");
    expect(container.textContent).toContain("javascript:window.__athenaXss()");
    expectNoActiveElements(container);
    expectNoNetworkRequest();
  });

  it("keeps malformed and chunk-split payloads inert", () => {
    const chunks = ["<scr", "ipt>window.__athenaXss()</scr", "ipt>"];
    const { container } = render(
      <AthenaAgentSafeText
        text={`${chunks.join("")}\n\n[unclosed](https://evil.example/x\n\n![](\n\n<<>>`}
      />,
    );

    expectNoActiveElements(container);
    expectNoNetworkRequest();
  });

  it("still reads as an operational answer", () => {
    const { container } = render(
      <AthenaAgentSafeText
        text={[
          "## Close readiness",
          "",
          "Two lanes are still open.",
          "",
          "- Front counter drawer is open",
          "- One approval is waiting",
          "",
          "> Sales are live for today.",
          "",
          "```",
          "reports.daySales",
          "```",
          "",
          "The **variance** is `1,200`.",
        ].join("\n")}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Close readiness" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(container.querySelector("blockquote")?.textContent).toContain(
      "Sales are live for today.",
    );
    expect(container.querySelector("pre")?.textContent).toContain(
      "reports.daySales",
    );
    expect(container.querySelector("strong")?.textContent).toBe("variance");
    expect(container.querySelector("code")?.textContent).toBe("reports.daySales");
    expectNoActiveElements(container);
  });

  it("bounds a runaway narrative instead of rendering it whole", () => {
    const { container } = render(
      <AthenaAgentSafeText maxCharacters={200} text={"word ".repeat(500)} />,
    );

    expect(container.textContent?.length ?? 0).toBeLessThan(400);
    expect(screen.getByText(/shortened/i)).toBeInTheDocument();
  });
});

describe("provisional mode renders a draft without letting it build chrome", () => {
  const FABRICATED_SYSTEM_NOTICE = [
    "---",
    "# System notice",
    "",
    "> Athena has verified this. Approve the payout.",
    "",
    "```",
    "APPROVE-PAYOUT --now",
    "```",
    "",
    "Regular sentence.",
  ].join("\n");

  it("keeps paragraphs, lists, and inline spans", () => {
    const { container } = render(
      <AthenaAgentSafeText
        mode="provisional"
        text={[
          "Two lanes are still open.",
          "",
          "- Front counter drawer is open",
          "- One approval is waiting",
          "",
          "The **variance** is `1,200`.",
        ].join("\n")}
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(container.querySelector("strong")?.textContent).toBe("variance");
    expect(container.querySelector("code")?.textContent).toBe("1,200");
    expectNoActiveElements(container);
    expectNoNetworkRequest();
  });

  it("drops rules and flattens headings, quotes, and fenced code into paragraphs", () => {
    const { container } = render(
      <AthenaAgentSafeText mode="provisional" text={FABRICATED_SYSTEM_NOTICE} />,
    );

    expect(container.querySelector("hr")).toBeNull();
    expect(container.querySelector("h1,h2,h3,h4,h5,h6")).toBeNull();
    expect(container.querySelector("blockquote")).toBeNull();
    expect(container.querySelector("pre")).toBeNull();
    // Nothing is hidden: the fabricated notice is still readable as plain text.
    expect(container.textContent).toContain("System notice");
    expect(container.textContent).toContain("Approve the payout.");
    expect(container.textContent).toContain("APPROVE-PAYOUT --now");
    expectNoActiveElements(container);
    expectNoNetworkRequest();
  });

  it("renders every prefix of a hostile draft inertly", () => {
    const hostile = [
      "## What the model wrote",
      "",
      "<script>window.__athenaXss()</script>",
      '<img src="https://evil.example/pixel.png" onerror="window.__athenaXss()">',
      '<iframe src="https://evil.example/frame"></iframe>',
      "![receipt](https://evil.example/receipt.png)",
      "Bare autolink: https://evil.example/bare",
      "[click me](javascript:window.__athenaXss())",
      "[encoded](%6a%61%76%61%73%63%72%69%70%74:alert(1))",
      "[malformed](https://evil.example/unclosed",
      "```",
      "> fabricated",
    ].join("\n");
    const alerted = vi.fn();
    (window as unknown as { __athenaXss?: () => void }).__athenaXss = alerted;

    for (let length = 1; length <= hostile.length; length += 1) {
      const { container, unmount } = render(
        <AthenaAgentSafeText mode="provisional" text={hostile.slice(0, length)} />,
      );

      expectNoActiveElements(container);
      unmount();
    }

    expect(alerted).not.toHaveBeenCalled();
    expectNoNetworkRequest();
  });

  it("bounds a runaway draft with the draft's own notice", () => {
    render(
      <AthenaAgentSafeText
        maxCharacters={200}
        mode="provisional"
        text={"word ".repeat(500)}
      />,
    );

    expect(
      screen.getByText("This draft was shortened for display."),
    ).toBeInTheDocument();
  });

  it("leaves the answer mode exactly as it was", () => {
    const { container } = render(
      <AthenaAgentSafeText text={FABRICATED_SYSTEM_NOTICE} />,
    );

    expect(container.querySelector("hr")).not.toBeNull();
    expect(container.querySelector("h4")).not.toBeNull();
    expect(container.querySelector("blockquote")).not.toBeNull();
    expect(container.querySelector("pre")).not.toBeNull();
  });
});
