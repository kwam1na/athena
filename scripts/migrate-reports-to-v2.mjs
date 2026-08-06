// One-off migration: contract v1 delivery reports -> contract v2.
//
// Deterministic on purpose. Prose nodes are MOVED, never retyped, so wording
// is preserved byte-for-byte; only the surrounding structure changes.
//
//   node scripts/migrate-reports-to-v2.mjs --dry-run   # report mapping coverage
//   node scripts/migrate-reports-to-v2.mjs <file...>   # convert in place

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { JSDOM } from "jsdom";

// One 2026-07-16 revert report shipped a quiz with NO answer key anywhere —
// no data-answer, no script, no answers map — so it never graded. These
// indices are read off that report's own prose (the distractors are
// self-evidently wrong: "Deletes POS entirely", "It is not safe", "Rotate all
// production keys"). They are recorded here rather than inferred silently so
// the one place a key was authored is obvious and reviewable.
const AUTHORED_ANSWER_KEYS = {
  "2026-07-16-revert-store-service-principals-report.html": [1, 0, 1],
};

const REQUIRED_KEYS = [
  "summary",
  "problem",
  "mental-model",
  "before-after",
  "key-files",
  "changes",
  "validation",
  "guidance",
  "quiz",
  "subagent-evidence",
];

// Ordered: first matching rule wins. Built from the actual heading vocabulary
// across the corpus, not guessed.
const HEADING_RULES = [
  [/subagent|independently gathered|what was gathered|evidence gathered/i, "subagent-evidence"],
  [/quiz/i, "quiz"],
  [/executive summary/i, "summary"],
  [/^summary$/i, "summary"],
  [/problem|why it mattered|why this mattered|why it matters|context/i, "problem"],
  [/mental model|intuition|how to think/i, "mental-model"],
  [/before and after|before vs|before\/after/i, "before-after"],
  [/key files|files worth reading|files that matter|important files/i, "key-files"],
  [/what changed|did not change|what shipped|changes by layer|layer-by-layer|what is new/i, "changes"],
  [/validation|review evidence|evidence and validation|testing/i, "validation"],
  [/next-time|next time|guidance|how to modify|how to extend|operational|maintenance|candidate status/i, "guidance"],
];

function slugify(text) {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/, "") || "section"
  );
}

function classifyHeading(text) {
  for (const [pattern, key] of HEADING_RULES) {
    if (pattern.test(text)) return key;
  }
  return null;
}

/**
 * Some reports keep the answer key in the grading script rather than on the
 * markup: `answers = { q1: "b", q2: "a", ... }`, keyed by the radio group name.
 */
function parseScriptAnswerKey(html) {
  const objectBlock = html.match(/answers?\s*[:=]\s*\{([^}]*)\}/i)?.[1];
  const key = new Map();
  if (objectBlock) {
    for (const entry of objectBlock.matchAll(
      /(["']?)(\w+)\1\s*:\s*["']([^"']+)["']/g,
    )) {
      key.set(entry[2], entry[3]);
    }
    return key;
  }
  // Array form: answers = ["b", "a", ...] positional by question order, which
  // maps onto the qN radio-group naming the same reports use.
  const arrayBlock = html.match(/answers?\s*[:=]\s*\[([^\]]*)\]/i)?.[1];
  if (arrayBlock) {
    const values = [...arrayBlock.matchAll(/["']([^"']+)["']|(-?\d+)/g)].map(
      (match) => match[1] ?? match[2],
    );
    values.forEach((value, index) => {
      // Reports differ on whether the radio groups start at q0 or q1; register
      // both so the lookup by group name succeeds either way.
      key.set(`q${index}`, value);
      if (!key.has(`q${index + 1}`)) key.set(`q${index + 1}`, value);
    });
  }
  return key;
}

/**
 * Several reports render the quiz at runtime from a JS array and leave the
 * container empty, so the questions exist only inside the <script> we strip.
 * Both shipped shapes are supported:
 *   object: { s: prompt, a: [options], c: correctIndex, e: explanation }
 *   tuple:  [ prompt, [options], correctIndex, explanation ]
 */
function parseScriptQuestionArray(html) {
  const start = html.match(/(?:const|let|var)\s+(?:QUESTIONS|questions|quizData|QUIZ)\s*=\s*\[/);
  if (!start) return null;
  const from = start.index + start[0].length - 1;
  let depth = 0;
  let end = -1;
  for (let i = from; i < html.length; i += 1) {
    const ch = html[i];
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end < 0) return null;
  let raw;
  try {
    raw = vm.runInNewContext(`(${html.slice(from, end)})`, {}, { timeout: 2000 });
  } catch {
    return null;
  }
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const questions = [];
  for (const entry of raw) {
    if (Array.isArray(entry)) {
      const [prompt, options, correctIndex, explanation] = entry;
      if (typeof prompt !== "string" || !Array.isArray(options)) return null;
      questions.push({ prompt: prompt.replace(/^\s*\d{1,2}[.)]\s+/, ""), options, correctIndex: Number(correctIndex), explanation: explanation ?? "" });
    } else if (entry && typeof entry === "object") {
      const prompt = entry.s ?? entry.q ?? entry.question;
      const options = entry.a ?? entry.options;
      const correctIndex = entry.c ?? entry.correct ?? entry.answer;
      if (typeof prompt !== "string" || !Array.isArray(options)) return null;
      questions.push({ prompt: prompt.replace(/^\s*\d{1,2}[.)]\s+/, ""), options, correctIndex: Number(correctIndex), explanation: entry.e ?? entry.exp ?? entry.explanation ?? "" });
    } else return null;
  }
  return questions.every(
    (q) => Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex < q.options.length,
  )
    ? questions
    : null;
}

/** Resolve which option index is correct across the v1 dialects. */
function resolveCorrectIndex(question, answerKey) {
  const inputs = [...question.querySelectorAll("input")];
  let declared = (question.getAttribute("data-answer") ?? "").trim();

  // Fall back to the script-side answer key, matched on the radio group name.
  if (!declared) {
    const groupName = inputs[0]?.getAttribute("name");
    if (groupName && answerKey.has(groupName)) {
      declared = answerKey.get(groupName);
    }
  }

  if (declared) {
    // Dialects use input value="a|b|c", value="0|1|2", or value="1|2|3";
    // matching the declared answer against the values covers all of them.
    const byValue = inputs.findIndex(
      (input) => (input.getAttribute("value") ?? "").trim() === declared,
    );
    if (byValue >= 0) return byValue;
  }

  // Fall back to the "Correct: B." letter in the explanation copy.
  const explanation = question.querySelector(
    ".answer-detail, .answer, .explanation",
  );
  const letter = explanation?.textContent?.match(/correct:\s*([a-d])\b/i)?.[1];
  if (letter) return letter.toLowerCase().charCodeAt(0) - 97;

  return -1;
}

function convert(html, filePath) {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const notes = [];

  // Root data-athena-* attributes may live on <html>, <body>, or a wrapper.
  const attributes = new Map();
  for (const element of [
    document.documentElement,
    document.body,
    document.querySelector("[data-athena-landed-change-report]"),
  ]) {
    if (!element) continue;
    for (const attribute of [...element.attributes]) {
      if (attribute.name.startsWith("data-athena-")) {
        attributes.set(attribute.name, attribute.value);
      }
    }
  }
  attributes.set("data-athena-landed-change-report", "v2");

  const title =
    document.querySelector("title")?.textContent?.trim() ??
    document.querySelector("h1")?.textContent?.trim() ??
    path.basename(filePath, ".html");
  const h1 = document.querySelector("h1");
  const pills = [...document.querySelectorAll(".pill")].map((pill) =>
    pill.textContent.trim(),
  );
  if (pills.length === 0) notes.push("no .pill elements; synthesized one pill");

  for (const node of document.querySelectorAll(
    "style, script, svg, img, iframe, object, embed",
  )) {
    node.remove();
  }
  // Strip presentation and behavior hooks document-wide, not just inside
  // sections: headers and wrappers carry them too.
  for (const styled of document.querySelectorAll("[style]")) {
    styled.removeAttribute("style");
  }
  for (const element of document.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      if (attribute.name.toLowerCase().startsWith("on")) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  const quizHost = document.querySelector("#changeQuiz");
  const quizForm = quizHost?.tagName === "FORM" ? quizHost : (quizHost?.querySelector("form") ?? quizHost);
  const quizSection = quizHost?.closest("section") ?? quizHost ?? null;

  // Header prose that is neither the h1 nor a pill (subtitles, lead-ins).
  const headerHost =
    h1?.closest("header") ?? h1?.parentElement ?? document.body;
  for (const control of headerHost?.querySelectorAll?.(
    "button, input, select, textarea",
  ) ?? []) {
    // Grade/Reset controls often sit in the header region; the app owns them.
    if (!quizSection || !quizSection.contains(control)) control.remove();
  }
  const headerExtras = [...(headerHost?.children ?? [])].filter(
    (child) =>
      child !== h1 &&
      !/^H[1-6]$/.test(child.tagName) &&
      !child.classList.contains("pill") &&
      !child.querySelector(".pill") &&
      child.textContent.trim().length > 0 &&
      !child.contains(quizSection ?? document.createElement("i")),
  );

  let sections = [...document.querySelectorAll("section")].filter(
    (section) => section !== quizSection && !section.contains(quizSection),
  );

  // Some reports never used <section>: headings and their content sit as flat
  // siblings inside a wrapper div. Segment those on <h2> boundaries so the
  // same mapping applies.
  if (sections.length === 0) {
    const headings = [...document.querySelectorAll("h2")].filter(
      (heading) => !quizForm || !quizForm.contains(heading),
    );
    sections = headings.map((heading) => {
      const synthetic = document.createElement("section");
      synthetic.appendChild(heading.cloneNode(true));
      let node = heading.nextElementSibling;
      while (node && node.tagName !== "H2") {
        if (!quizForm || !quizForm.contains(node)) {
          synthetic.appendChild(node.cloneNode(true));
        }
        node = node.nextElementSibling;
      }
      return synthetic;
    });
    if (sections.length > 0) {
      notes.push(`segmented ${sections.length} sections from flat h2 layout`);
    }
  }

  const used = new Set();
  const converted = [];
  for (const section of sections) {
    // Drop interactive leftovers and styling hooks before anything is kept.
    for (const control of section.querySelectorAll(
      "button, input, select, textarea, form",
    )) {
      control.remove();
    }
    for (const styled of section.querySelectorAll("[style]")) {
      styled.removeAttribute("style");
    }
    for (const handled of section.querySelectorAll("*")) {
      for (const attribute of [...handled.attributes]) {
        if (attribute.name.toLowerCase().startsWith("on")) {
          handled.removeAttribute(attribute.name);
        }
      }
    }

    const heading = section.querySelector("h2, h3");
    const headingText = heading?.textContent?.trim() ?? "";
    if (!headingText && section.textContent.trim().length === 0) continue;

    // Reports with a prose headline put the canonical label in an "eyebrow"
    // above it; that label is what identifies the section.
    const eyebrow = section.querySelector(
      ".eyebrow, .kicker, .label, .section-label",
    );
    const eyebrowText = eyebrow?.textContent?.trim() ?? "";

    let key = classifyHeading(eyebrowText) ?? classifyHeading(headingText);
    if (key === "quiz") continue; // handled separately
    if (!key || used.has(key)) {
      // Content still ships, just under its own key, so nothing is dropped.
      key = slugify(headingText || "section");
      if (used.has(key)) key = `${key}-${converted.length}`;
    }
    used.add(key);

    if (heading && heading.tagName !== "H2") {
      const replacement = document.createElement("h2");
      replacement.innerHTML = heading.innerHTML;
      heading.replaceWith(replacement);
    }
    if (heading) {
      // The contract requires the heading first; anything that preceded it
      // (eyebrow labels, kickers) moves directly after so nothing is lost.
      const current = section.querySelector("h2");
      if (current && section.firstElementChild !== current) {
        section.insertBefore(current, section.firstElementChild);
      }
    }
    let body = section.innerHTML.trim();
    if (!heading) {
      body = `<h2>${headingText || "Notes"}</h2>\n${body}`;
    }
    converted.push({ key, html: body, heading: headingText });
  }

  // Quiz
  let quiz = null;
  const answerKey = parseScriptAnswerKey(html);
  const scriptQuestions = parseScriptQuestionArray(html);
  if (scriptQuestions) {
    // Runtime-rendered quiz: the markup container is empty by design.
    const declared = Number(
      html.match(/pass threshold\s*(\d+)\s*\/\s*(\d+)/i)?.[1] ??
        html.match(/Pass threshold:\s*(\d+)\s*\/\s*(\d+)/i)?.[1],
    );
    const threshold = Number.isInteger(declared) && declared >= 1
      ? Math.min(declared, scriptQuestions.length)
      : Math.ceil(scriptQuestions.length * 0.8);
    quiz = {
      threshold,
      questions: scriptQuestions.map((q) => ({
        prompt: q.prompt,
        options: q.options,
        correctIndex: q.correctIndex,
        explanation: q.explanation || "See the section above for the reasoning.",
      })),
    };
    notes.push(`quiz recovered from script array (${scriptQuestions.length} questions)`);
  } else if (quizForm) {
    const questions = [...quizForm.querySelectorAll(".quiz-question")];
    const nodes = questions.length
      ? questions
      : [...quizForm.querySelectorAll("fieldset")].map((f) => f.parentElement ?? f);
    const authored = AUTHORED_ANSWER_KEYS[path.basename(filePath)];
    const parsed = [];
    for (const [questionIndex, question] of nodes.entries()) {
      const promptNode = question.querySelector("legend, .question, p, h3, h4");
      const optionNodes = [...question.querySelectorAll("label")];
      const explanationNode = question.querySelector(
        ".answer-detail, .answer, .explanation",
      );
      let correctIndex = resolveCorrectIndex(question, answerKey);
      if (correctIndex < 0 && authored) {
        correctIndex = authored[questionIndex] ?? -1;
        if (correctIndex >= 0 && questionIndex === 0) {
          notes.push("answer key authored from report prose (original had none)");
        }
      }
      if (!promptNode || optionNodes.length < 2 || correctIndex < 0) {
        return { error: `unparseable quiz question in ${path.basename(filePath)}` };
      }
      const promptClone = promptNode.cloneNode(true);
      for (const strip of promptClone.querySelectorAll("input, .answer-detail")) {
        strip.remove();
      }
      // v1 legends carried their own "1. " because the page did not number
      // them. The rendered page does, so keeping it would double-number.
      promptClone.innerHTML = promptClone.innerHTML.replace(
        /^\s*\d{1,2}[.)]\s+/,
        "",
      );
      const options = optionNodes.map((label) => {
        const clone = label.cloneNode(true);
        for (const input of clone.querySelectorAll("input")) input.remove();
        return clone.innerHTML.trim();
      });
      parsed.push({
        prompt: promptClone.innerHTML.trim(),
        options,
        correctIndex,
        explanation: explanationNode
          ? explanationNode.innerHTML.trim()
          : "See the section above for the reasoning.",
      });
      if (!explanationNode) notes.push("a question had no explanation copy");
    }
    const declaredThreshold = Number(quizForm.getAttribute("data-threshold"));
    const threshold =
      Number.isInteger(declaredThreshold) && declaredThreshold >= 1
        ? Math.min(declaredThreshold, parsed.length)
        : Math.ceil(parsed.length * 0.8);
    if (!Number.isInteger(declaredThreshold)) {
      notes.push(`threshold derived as ${threshold} (80% of ${parsed.length})`);
    }
    quiz = { threshold, questions: parsed };
  }

  // Only the presentation-contract essentials block conversion; the narrative
  // vocabulary is a delivery-time requirement for newly authored reports.
  // Only a parseable quiz blocks conversion. Subagent evidence is a
  // delivery-time content requirement; the oldest report predates it.
  const missing = quiz ? [] : ["quiz"];
  if (!used.has("subagent-evidence")) {
    notes.push("no subagent-evidence section in the original");
  }

  return {
    notes,
    missing,
    title,
    attributes,
    h1Html: h1 ? h1.innerHTML.trim() : title,
    headerExtras: headerExtras.map((node) => node.outerHTML),
    pills,
    sections: converted,
    quiz,
  };
}

function serialize(result) {
  const attrs = [...result.attributes.entries()]
    .map(([name, value]) => `${name}="${value}"`)
    .join("\n  ");
  const pills = (result.pills.length ? result.pills : ["Delivery report"])
    .map((pill) => `      <li>${pill}</li>`)
    .join("\n");

  const ordered = [
    ...result.sections.filter(
      (section) => section.key !== "subagent-evidence",
    ),
  ];
  const evidence = result.sections.find(
    (section) => section.key === "subagent-evidence",
  );

  const body = ordered
    .map(
      (section) =>
        `  <section data-report-section="${section.key}">\n${section.html}\n  </section>`,
    )
    .join("\n");

  let quizHtml = "";
  if (result.quiz) {
    const items = result.quiz.questions
      .map((question) => {
        const options = question.options
          .map(
            (option, index) =>
              `          <li${index === question.correctIndex ? " data-quiz-correct" : ""}>${option}</li>`,
          )
          .join("\n");
        return `      <li data-quiz-question>
        <p data-quiz-prompt>${question.prompt}</p>
        <ol data-quiz-options>
${options}
        </ol>
        <p data-quiz-explanation>${question.explanation}</p>
      </li>`;
      })
      .join("\n");
    quizHtml = `  <section data-report-section="quiz" data-quiz-pass-threshold="${result.quiz.threshold}">
    <h2>Comprehension quiz</h2>
    <p>Pass required: ${result.quiz.threshold} of ${result.quiz.questions.length}.</p>
    <ol data-quiz>
${items}
    </ol>
  </section>`;
  }

  const evidenceHtml = evidence
    ? `  <section data-report-section="subagent-evidence">\n${evidence.html}\n  </section>`
    : "";

  const extras = result.headerExtras.map((html) => `    ${html}`).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${result.title}</title>
</head>
<body>
<article
  ${attrs}
>
  <header data-report-section="header">
    <h1>${result.h1Html}</h1>
${extras ? extras + "\n" : ""}    <ul data-report-pills>
${pills}
    </ul>
  </header>
${body}
${quizHtml}
${evidenceHtml}
</article>
</body>
</html>
`;
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const targets = args.filter((arg) => !arg.startsWith("--"));
const files =
  targets.length > 0
    ? targets
    : fs
        .readdirSync("docs/reports")
        .filter((file) => file.endsWith(".html"))
        .map((file) => path.join("docs/reports", file));

let converted = 0;
const problems = [];
for (const file of files) {
  const html = fs.readFileSync(file, "utf8");
  if (html.includes('data-athena-landed-change-report="v2"')) continue;
  const result = convert(html, file);
  if (result.error) {
    problems.push(`${path.basename(file)}: ${result.error}`);
    continue;
  }
  const detail = [];
  if (result.missing.length) detail.push(`missing: ${result.missing.join(",")}`);
  if (result.notes.length) detail.push(result.notes.join("; "));
  if (detail.length) problems.push(`${path.basename(file)}: ${detail.join(" | ")}`);
  if (!dryRun && result.missing.length === 0) {
    fs.writeFileSync(file, serialize(result));
    converted += 1;
  }
}

console.log(dryRun ? "DRY RUN" : `converted ${converted} file(s)`);
if (problems.length) {
  console.log(`\n${problems.length} file(s) need attention:`);
  for (const problem of problems) console.log(`  ${problem}`);
}
