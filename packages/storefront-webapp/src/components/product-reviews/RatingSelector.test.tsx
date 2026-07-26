import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RatingSelector } from "./RatingSelector";

describe("RatingSelector", () => {
  afterEach(cleanup);

  it("exposes five named rating actions and keeps pointer/keyboard selection", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <RatingSelector label="Quality" value={2} onChange={onChange} />,
    );

    const fourStars = screen.getByRole("button", {
      name: "Rate Quality 4 out of 5",
    });

    fourStars.focus();
    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith(4);
    expect(screen.getAllByRole("button")).toHaveLength(5);
  });
});
