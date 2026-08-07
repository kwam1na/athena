import { describe, expect, it } from "vitest";

import { collectReportPresentationFindings } from "./report-presentation-check";

function quizQuestion(prompt: string, index: number) {
  return `
    <li data-quiz-question>
      <p data-quiz-prompt>${prompt} ${index}?</p>
      <ol data-quiz-options>
        <li>Wrong answer.</li>
        <li data-quiz-correct>Right answer.</li>
        <li>Another wrong answer.</li>
      </ol>
      <p data-quiz-explanation>Because of the boundary.</p>
    </li>`;
}

function validReport({
  marker = 'data-athena-landed-change-report="v2"',
  pills = "<li>Delivery candidate</li>",
  questions = 5,
  threshold = 4,
  extraSections = "",
  quizAttributes = "",
  keyFilesBody = "<table><tr><th>File</th><th>Why</th></tr></table>",
}: {
  marker?: string;
  pills?: string;
  questions?: number;
  threshold?: number;
  extraSections?: string;
  quizAttributes?: string;
  keyFilesBody?: string;
} = {}) {
  const quizBody = Array.from({ length: questions }, (_, index) =>
    quizQuestion("Why does the seam hold", index + 1),
  ).join("\n");

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>Fixture report</title></head>
<body>
<article ${marker} data-athena-report-diff-fingerprint="abc123">
  <header data-report-section="header">
    <h1>Fixture report</h1>
    <ul data-report-pills>${pills}</ul>
    <dl data-report-meta><dt>PR</dt><dd>#1</dd></dl>
  </header>
  <section data-report-section="summary"><h2>Executive summary</h2><p>Summary.</p></section>
  <section data-report-section="problem"><h2>Problem</h2><p>Problem.</p></section>
  <section data-report-section="mental-model"><h2>Mental model</h2><p>Model.</p></section>
  <section data-report-section="before-after"><h2>Before and after</h2><p>Delta.</p></section>
  <section data-report-section="key-files"><h2>Key files</h2>${keyFilesBody}</section>
  <section data-report-section="changes"><h2>What changed</h2><p>Changes.</p></section>
  <section data-report-section="validation"><h2>Validation</h2><p>Evidence.</p></section>
  <section data-report-section="guidance"><h2>Next-time guidance</h2><p>Guidance.</p></section>
  ${extraSections}
  <section data-report-section="quiz" data-quiz-pass-threshold="${threshold}"${quizAttributes}>
    <h2>Comprehension quiz</h2>
    <ol data-quiz>${quizBody}</ol>
  </section>
  <section data-report-section="subagent-evidence"><h2>Subagent evidence</h2><p>Names.</p></section>
</article>
</body>
</html>`;
}

function messages(html: string) {
  return collectReportPresentationFindings("docs/reports/fixture.html", html).map(
    (finding) => finding.message,
  );
}

/** Delivery-time mode: the fuller narrative vocabulary is also required. */
function newReportMessages(html: string) {
  return collectReportPresentationFindings("docs/reports/fixture.html", html, {
    requireNarrativeSections: true,
  }).map((finding) => finding.message);
}

describe("collectReportPresentationFindings", () => {
  it("accepts a conforming v2 report", () => {
    expect(messages(validReport())).toEqual([]);
  });

  it("accepts extra kebab-case sections before the quiz", () => {
    const html = validReport({
      extraSections:
        '<section data-report-section="failure-boundaries"><h2>Failure boundaries</h2><p>Edges.</p></section>',
    });
    expect(messages(html)).toEqual([]);
  });

  it("rejects a missing or non-v2 root marker", () => {
    expect(messages(validReport({ marker: "" })).join("\n")).toContain(
      "expected exactly one data-athena-landed-change-report root marker, found 0",
    );
    expect(
      messages(
        validReport({ marker: 'data-athena-landed-change-report="v1"' }),
      ).join("\n"),
    ).toContain('report declares contract "v1"; expected "v2"');
  });

  it("rejects embedded styling and scripting", () => {
    const base = validReport();
    const withStyle = base.replace("<body>", "<body><style>p{color:red}</style>");
    const withScript = base.replace("</body>", "<script>alert(1)</script></body>");
    const withInlineStyle = base.replace(
      "<p>Summary.</p>",
      '<p style="color:red">Summary.</p>',
    );
    const withHandler = base.replace(
      "<p>Summary.</p>",
      '<p onclick="x()">Summary.</p>',
    );

    expect(messages(withStyle).join("\n")).toContain("forbidden markup: <style> element");
    expect(messages(withScript).join("\n")).toContain("forbidden markup: <script> element");
    expect(messages(withInlineStyle).join("\n")).toContain(
      "forbidden markup: inline style attribute",
    );
    expect(messages(withHandler).join("\n")).toContain(
      "forbidden markup: inline event handler",
    );
  });

  it("requires the header, pills, and single h1", () => {
    const noPills = validReport().replace(
      /<ul data-report-pills>.*<\/ul>/,
      "",
    );
    expect(messages(noPills).join("\n")).toContain(
      "missing <ul data-report-pills> status pills",
    );

    const emptyPills = validReport({ pills: "" });
    expect(messages(emptyPills).join("\n")).toContain(
      "data-report-pills has no <li> pill entries",
    );

    const twoTitles = validReport().replace(
      "<h2>Executive summary</h2>",
      "<h1>Second title</h1>",
    );
    expect(messages(twoTitles).join("\n")).toContain(
      "expected exactly one <h1>, found 2",
    );
  });

  it("requires a quiz section of every report, historical included", () => {
    const withoutQuiz = validReport().replace(
      /<section data-report-section="quiz"[\s\S]*?<\/section>/,
      "",
    );
    expect(messages(withoutQuiz).join("\n")).toContain(
      'missing required section data-report-section="quiz"',
    );
  });

  // The oldest report predates the subagent workflow entirely.
  it("requires subagent evidence only for newly authored reports", () => {
    const withoutEvidence = validReport().replace(
      /<section data-report-section="subagent-evidence">.*?<\/section>/,
      "",
    );
    expect(messages(withoutEvidence)).toEqual([]);
    expect(newReportMessages(withoutEvidence).join("\n")).toContain(
      'missing narrative section data-report-section="subagent-evidence"',
    );
  });

  // Historical reports predate the narrative vocabulary; retro-fitting them
  // would mean inventing sections they never had. Newly authored reports are
  // held to it at delivery time instead.
  it("requires the narrative vocabulary only for newly authored reports", () => {
    const withoutValidation = validReport().replace(
      /<section data-report-section="validation">.*?<\/section>/,
      "",
    );
    expect(messages(withoutValidation)).toEqual([]);
    expect(newReportMessages(withoutValidation).join("\n")).toContain(
      'missing narrative section data-report-section="validation"',
    );
  });

  it("ignores contract markers quoted inside report prose", () => {
    // The gate report documents the contract and shows the marker in code
    // samples; only the <article> attribute is a real root.
    const html = validReport().replace(
      "<p>Summary.</p>",
      "<p>Reports carry <code>data-athena-landed-change-report=\"v1\"</code>.</p>",
    );
    expect(messages(html)).toEqual([]);
  });

  it("requires sections to open with an h2", () => {
    const html = validReport().replace(
      '<section data-report-section="problem"><h2>Problem</h2>',
      '<section data-report-section="problem"><p>No heading.</p><h2>Problem</h2>',
    );
    expect(messages(html).join("\n")).toContain(
      'section "problem" must start with an <h2>, found <p>',
    );
  });

  it("requires the key-files table only for newly authored reports", () => {
    const html = validReport({ keyFilesBody: "<p>No table here.</p>" });
    expect(messages(html)).toEqual([]);
    expect(newReportMessages(html).join("\n")).toContain(
      "key-files section is missing its <table>",
    );
  });

  it("enforces quiz and subagent-evidence as the final sections", () => {
    const html = validReport({
      extraSections: "",
    }).replace(
      /(<section data-report-section="subagent-evidence">.*?<\/section>)\n<\/article>/s,
      "$1\n<section data-report-section=\"appendix\"><h2>Appendix</h2><p>Late.</p></section>\n</article>",
    );
    expect(messages(html).join("\n")).toContain(
      "quiz and subagent-evidence must be the last two sections",
    );
  });

  it("enforces quiz size, threshold, and per-question structure", () => {
    // A short historical quiz is well-formed; only new reports owe five.
    expect(messages(validReport({ questions: 3, threshold: 2 }))).toEqual([]);
    expect(
      newReportMessages(validReport({ questions: 4, threshold: 3 })).join("\n"),
    ).toContain("quiz has 4 questions; the contract requires at least 5");
    expect(messages(validReport({ threshold: 9 })).join("\n")).toContain(
      "quiz pass threshold 9 exceeds its 5 questions",
    );

    const missingThreshold = validReport().replace(
      / data-quiz-pass-threshold="4"/,
      "",
    );
    expect(messages(missingThreshold).join("\n")).toContain(
      "missing a valid integer data-quiz-pass-threshold",
    );

    const twoCorrect = validReport().replace(
      "<li>Wrong answer.</li>",
      "<li data-quiz-correct>Wrong answer.</li>",
    );
    expect(messages(twoCorrect).join("\n")).toContain(
      "marks 2 options data-quiz-correct; exactly one is required",
    );

    const noExplanation = validReport().replace(
      "<p data-quiz-explanation>Because of the boundary.</p>",
      "",
    );
    expect(messages(noExplanation).join("\n")).toContain(
      "quiz question 1 is missing a data-quiz-explanation",
    );
  });

  // The v1 pages did not number questions, so authors wrote "1. " into the
  // legend. The rendered page numbers them, so a carried-over number shows as
  // "1. 1. …".
  it("rejects a quiz prompt that carries its own number", () => {
    const numbered = validReport().replace(
      "<p data-quiz-prompt>Why does the seam hold 1?</p>",
      "<p data-quiz-prompt>1. Why does the seam hold?</p>",
    );
    expect(messages(numbered).join("\n")).toContain(
      "quiz question 1 prompt begins with its own number",
    );

    const twoDigit = validReport().replace(
      "<p data-quiz-prompt>Why does the seam hold 1?</p>",
      "<p data-quiz-prompt>10) Why does the seam hold?</p>",
    );
    expect(messages(twoDigit).join("\n")).toContain(
      "quiz question 1 prompt begins with its own number",
    );
  });

  it("allows a prompt whose text legitimately opens with a number", () => {
    const html = validReport().replace(
      "<p data-quiz-prompt>Why does the seam hold 1?</p>",
      "<p data-quiz-prompt>2026 rollups were wrong — why?</p>",
    );
    expect(messages(html)).toEqual([]);
  });

  it("rejects an in-page anchor with no matching id", () => {
    const html = validReport().replace(
      "<p>Summary.</p>",
      '<p><a href="#mental-model">Jump to the model</a></p>',
    );
    expect(messages(html).join("\n")).toContain(
      'in-page anchor href="#mental-model" has no matching id in the report',
    );
  });

  it("accepts an in-page anchor the report defines an id for", () => {
    const html = validReport()
      .replace(
        '<section data-report-section="mental-model">',
        '<section data-report-section="mental-model" id="model">',
      )
      .replace("<p>Summary.</p>", '<p><a href="#model">Jump to the model</a></p>');
    expect(messages(html)).toEqual([]);
  });

  it("reports each dead fragment once however often it is linked", () => {
    const html = validReport().replace(
      "<p>Summary.</p>",
      '<p><a href="#gone">One</a><a href="#gone">Two</a></p>',
    );
    expect(
      messages(html).filter((message) => message.includes('href="#gone"')),
    ).toHaveLength(1);
  });

  it("rejects header metadata that is not marked data-report-meta", () => {
    const html = validReport().replace(
      "<dl data-report-meta>",
      '<dl class="meta">',
    );
    expect(messages(html).join("\n")).toContain(
      "header <dl> is missing data-report-meta",
    );
  });

  it("leaves definition lists outside the header alone", () => {
    const html = validReport().replace(
      "<p>Summary.</p>",
      "<dl><dt>Term</dt><dd>Body prose, not header metadata.</dd></dl>",
    );
    expect(messages(html)).toEqual([]);
  });

  it("rejects non-kebab-case section keys", () => {
    const html = validReport({
      extraSections:
        '<section data-report-section="Extra_Notes"><h2>Notes</h2><p>Hmm.</p></section>',
    });
    expect(messages(html).join("\n")).toContain(
      'section key "Extra_Notes" is not kebab-case',
    );
  });
});
