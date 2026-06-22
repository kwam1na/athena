import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HomeHero } from "./HomeHero";
import { VideoPlayer } from "./VideoPlayer";

vi.mock("@/contexts/StoreContext", () => ({
  useStoreContext: () => ({ store: undefined }),
}));

vi.mock("../ui/ScrollDownButton", () => ({
  ScrollDownButton: () => <button type="button">Scroll</button>,
}));

vi.mock("hls.js/light", () => ({
  default: class HlsMock {
    static Events = { MANIFEST_PARSED: "manifestParsed" };
    static isSupported() {
      return false;
    }
    loadSource() {}
    attachMedia() {}
    on() {}
    destroy() {}
  },
}));

describe("HomeHero", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps the hero silent while store media config is unresolved", () => {
    render(<HomeHero />);

    expect(screen.getByTestId("homepage-hero-media-pending")).toHaveClass(
      "bg-background",
    );
    expect(screen.queryByText("Find your next look")).not.toBeInTheDocument();
    expect(screen.queryByText("Shop hair")).not.toBeInTheDocument();
  });

  it("does not render browser fallback text inside the hero video", () => {
    const { container } = render(
      <VideoPlayer hlsUrl="https://cdn.example.com/hero.m3u8" />,
    );

    expect(container).not.toHaveTextContent(
      "Your browser does not support the video tag.",
    );
    expect(container.querySelector("source")).toHaveAttribute(
      "type",
      "application/x-mpegURL",
    );
  });
});
