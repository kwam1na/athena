import { describe, expect, it } from "vitest";

import { parseReportDocument } from "./reportContract";

const V2_REPORT = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>Fixture</title></head>
<body>
<article data-athena-landed-change-report="v2" data-athena-report-diff-fingerprint="abc">
  <header data-report-section="header">
    <h1>Fixture report</h1>
    <ul data-report-pills><li>Delivery candidate</li><li>PR #1</li></ul>
    <dl data-report-meta><dt>Status</dt><dd>Landed</dd><dt>PR</dt><dd>#1</dd></dl>
  </header>
  <section data-report-section="summary"><h2>Executive summary</h2><p>The <code>foldDay</code> seam.</p></section>
  <section data-report-section="key-files"><h2>Key files</h2><table><tbody><tr><td>a.ts</td><td>why</td></tr></tbody></table></section>
  <section data-report-section="quiz" data-quiz-pass-threshold="2">
    <h2>Comprehension quiz</h2>
    <ol data-quiz>
      <li data-quiz-question>
        <p data-quiz-prompt>Why <em>this</em>?</p>
        <ol data-quiz-options>
          <li>Wrong.</li>
          <li data-quiz-correct>Right, because <code>x</code>.</li>
        </ol>
        <p data-quiz-explanation>Because of the boundary.</p>
      </li>
      <li data-quiz-question>
        <p data-quiz-prompt>Second question?</p>
        <ol data-quiz-options>
          <li data-quiz-correct>Yes.</li>
          <li>No.</li>
        </ol>
        <p data-quiz-explanation>It is.</p>
      </li>
    </ol>
  </section>
  <section data-report-section="subagent-evidence"><h2>Subagent evidence</h2><p>Names.</p></section>
</article>
</body>
</html>`;

describe("parseReportDocument", () => {
  it("returns null for a non-v2 document", () => {
    expect(parseReportDocument("<html><body><p>old report</p></body></html>")).toBeNull();
    expect(
      parseReportDocument(
        '<html data-athena-landed-change-report="v1"><body></body></html>',
      ),
    ).toBeNull();
  });

  it("extracts pills and metadata pairs", () => {
    const report = parseReportDocument(V2_REPORT);
    expect(report?.pills).toEqual(["Delivery candidate", "PR #1"]);
    expect(report?.meta).toEqual([
      { label: "Status", value: "Landed" },
      { label: "PR", value: "#1" },
    ]);
  });

  it("keeps content sections but excludes the header and quiz", () => {
    const report = parseReportDocument(V2_REPORT);
    expect(report?.sectionsHtml).toContain("Executive summary");
    expect(report?.sectionsHtml).toContain("<table>");
    expect(report?.sectionsHtml).toContain("subagent-evidence");
    expect(report?.sectionsHtml).not.toContain("<h1>");
    expect(report?.sectionsHtml).not.toContain("data-quiz-prompt");
  });

  it("parses quiz questions with inline markup, correct index, and threshold", () => {
    const quiz = parseReportDocument(V2_REPORT)?.quiz;
    expect(quiz?.passThreshold).toBe(2);
    expect(quiz?.questions).toHaveLength(2);
    expect(quiz?.questions[0].promptHtml).toBe("Why <em>this</em>?");
    expect(quiz?.questions[0].correctIndex).toBe(1);
    expect(quiz?.questions[0].optionsHtml[1]).toContain("<code>x</code>");
    expect(quiz?.questions[1].correctIndex).toBe(0);
  });

  it("clamps a threshold above the question count", () => {
    const html = V2_REPORT.replace(
      'data-quiz-pass-threshold="2"',
      'data-quiz-pass-threshold="9"',
    );
    expect(parseReportDocument(html)?.quiz?.passThreshold).toBe(2);
  });

  it("returns a null quiz when a question is malformed", () => {
    const html = V2_REPORT.replace(" data-quiz-correct", "");
    expect(parseReportDocument(html)?.quiz).toBeNull();
  });

  it("strips scripting even if a report evaded the sensor", () => {
    const html = V2_REPORT.replace(
      "<p>The <code>foldDay</code> seam.</p>",
      '<p onclick="x()">The seam.</p><script>alert(1)</script><a href="javascript:x()">link</a>',
    );
    const report = parseReportDocument(html);
    expect(report?.sectionsHtml).not.toContain("<script");
    expect(report?.sectionsHtml).not.toContain("onclick");
    expect(report?.sectionsHtml).not.toContain("javascript:");
  });

  it("opens external links in a new tab", () => {
    const html = V2_REPORT.replace(
      "<p>Names.</p>",
      '<p><a href="https://example.com">evidence</a></p>',
    );
    const report = parseReportDocument(html);
    expect(report?.sectionsHtml).toContain('target="_blank"');
    expect(report?.sectionsHtml).toContain('rel="noreferrer"');
  });
});
