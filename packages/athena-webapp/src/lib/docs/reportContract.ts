// Browser-side reader for contract-v2 delivery reports (the authoring-side
// contract lives at .agents/skills/ce-landed-change-report/references/
// report-html-contract.md and is enforced by `bun run reports:presentation:check`).
// The webapp owns presentation: this module parses a report file into the
// pieces the page renders — pills, metadata, content sections, quiz data.

export type ReportQuizQuestion = {
  promptHtml: string;
  optionsHtml: string[];
  correctIndex: number;
  explanationHtml: string;
};

export type ReportQuiz = {
  passThreshold: number;
  questions: ReportQuizQuestion[];
};

export type ParsedReport = {
  pills: string[];
  meta: { label: string; value: string }[];
  /** Sanitized HTML of every content section, excluding header and quiz. */
  sectionsHtml: string;
  quiz: ReportQuiz | null;
};

const ROOT_SELECTOR = 'article[data-athena-landed-change-report="v2"]';

// The sensor forbids these at delivery time; stripping again here means a
// report that somehow bypassed the sensor still cannot inject behavior.
const FORBIDDEN_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "LINK",
  "IFRAME",
  "IMG",
  "SVG",
  "FORM",
  "INPUT",
  "BUTTON",
  "OBJECT",
  "EMBED",
]);

function sanitize(root: Element) {
  for (const element of Array.from(root.querySelectorAll("*"))) {
    if (FORBIDDEN_TAGS.has(element.tagName)) {
      element.remove();
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "style") {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (
        (name === "href" || name === "src") &&
        attribute.value.trim().toLowerCase().startsWith("javascript:")
      ) {
        element.removeAttribute(attribute.name);
      }
    }
    if (
      element.tagName === "A" &&
      /^https?:\/\//i.test(element.getAttribute("href") ?? "")
    ) {
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noreferrer");
    }
  }
}

function parseQuiz(section: Element): ReportQuiz | null {
  const threshold = Number(section.getAttribute("data-quiz-pass-threshold"));
  const questions: ReportQuizQuestion[] = [];

  for (const item of Array.from(
    section.querySelectorAll("[data-quiz-question]"),
  )) {
    const prompt = item.querySelector("[data-quiz-prompt]");
    const explanation = item.querySelector("[data-quiz-explanation]");
    const options = Array.from(
      item.querySelector("[data-quiz-options]")?.children ?? [],
    );
    const correctIndex = options.findIndex((option) =>
      option.hasAttribute("data-quiz-correct"),
    );
    if (!prompt || !explanation || options.length < 2 || correctIndex < 0) {
      return null;
    }
    questions.push({
      promptHtml: prompt.innerHTML,
      optionsHtml: options.map((option) => option.innerHTML),
      correctIndex,
      explanationHtml: explanation.innerHTML,
    });
  }

  if (questions.length === 0 || !Number.isInteger(threshold) || threshold < 1) {
    return null;
  }
  return { passThreshold: Math.min(threshold, questions.length), questions };
}

/** Returns null when the file is not a contract-v2 report. */
export function parseReportDocument(html: string): ParsedReport | null {
  const document = new DOMParser().parseFromString(html, "text/html");
  const article = document.querySelector(ROOT_SELECTOR);
  if (!article) return null;

  sanitize(article);

  const pills = Array.from(
    article.querySelectorAll("[data-report-pills] > li"),
  ).map((pill) => pill.textContent?.trim() ?? "");

  const meta: ParsedReport["meta"] = [];
  const metaList = article.querySelector("[data-report-meta]");
  if (metaList) {
    const terms = Array.from(metaList.querySelectorAll("dt"));
    const values = Array.from(metaList.querySelectorAll("dd"));
    terms.forEach((term, index) => {
      meta.push({
        label: term.textContent?.trim() ?? "",
        value: values[index]?.textContent?.trim() ?? "",
      });
    });
  }

  let quiz: ReportQuiz | null = null;
  const contentParts: string[] = [];
  for (const child of Array.from(article.children)) {
    const sectionKey = child.getAttribute("data-report-section");
    if (child.tagName === "HEADER" || sectionKey === "header") continue;
    if (sectionKey === "quiz") {
      quiz = parseQuiz(child);
      continue;
    }
    contentParts.push(child.outerHTML);
  }

  return { pills, meta, sectionsHtml: contentParts.join("\n"), quiz };
}
