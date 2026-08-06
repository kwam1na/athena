import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DocsReportQuiz } from "./DocsReportQuiz";
import type { ReportQuiz } from "@/lib/docs/reportContract";

const QUIZ: ReportQuiz = {
  passThreshold: 2,
  questions: [
    {
      promptHtml: "First question?",
      optionsHtml: ["Wrong one", "Right one"],
      correctIndex: 1,
      explanationHtml: "Explanation one.",
    },
    {
      promptHtml: "Second question?",
      optionsHtml: ["Right two", "Wrong two"],
      correctIndex: 0,
      explanationHtml: "Explanation two.",
    },
  ],
};

function answer(optionLabel: string) {
  fireEvent.click(screen.getByLabelText(optionLabel));
}

describe("DocsReportQuiz", () => {
  it("keeps grading disabled until every question is answered", () => {
    render(<DocsReportQuiz quiz={QUIZ} />);
    const grade = screen.getByRole("button", { name: "Grade quiz" });
    expect(grade).toBeDisabled();

    answer("Right one");
    expect(grade).toBeDisabled();
    expect(screen.getByText("1 of 2 answered")).toBeInTheDocument();

    answer("Right two");
    expect(grade).toBeEnabled();
  });

  it("grades against the pass threshold and shows explanations", () => {
    render(<DocsReportQuiz quiz={QUIZ} />);
    answer("Right one");
    answer("Wrong two");
    fireEvent.click(screen.getByRole("button", { name: "Grade quiz" }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "1 of 2 correct — below the 2 required",
    );
    expect(screen.getByText("Explanation one.")).toBeInTheDocument();
    expect(screen.getByText("Explanation two.")).toBeInTheDocument();
  });

  it("reports a pass and resets for a retake", () => {
    render(<DocsReportQuiz quiz={QUIZ} />);
    answer("Right one");
    answer("Right two");
    fireEvent.click(screen.getByRole("button", { name: "Grade quiz" }));
    expect(screen.getByRole("status")).toHaveTextContent("2 of 2 correct — passed");

    fireEvent.click(screen.getByRole("button", { name: /Retake/ }));
    expect(screen.getByText("0 of 2 answered")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
