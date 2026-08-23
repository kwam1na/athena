/**
 * Inert renderer for model-authored narrative.
 *
 * The narrative that reaches this component is untrusted text. It is parsed
 * into a closed set of text blocks and rendered as React text nodes only: this
 * pipeline has no way to emit a link, an image, an embed, a stylesheet, a
 * script, or any attribute that can start a request, so raw markup, autolinks,
 * unsafe protocols, encoded URLs, and payloads split across chunks all end up
 * as visible characters. Interactive destinations exist only for server-minted
 * citations, which the panel renders outside this component.
 *
 * Provisional mode narrows the vocabulary further. A draft is a partial buffer
 * the model is still writing, so anything that could read as Athena's own
 * structure — a rule, a heading, a quotation, a fenced block — is flattened to
 * a paragraph before it renders. The whole buffer is re-parsed on every render,
 * so a payload that is only dangerous once it is complete is inert at every
 * prefix as well.
 */
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { describeAthenaShortenedNotice } from "./AthenaAgentPresentationAdapter";

const DEFAULT_MAX_CHARACTERS = 24_000;
const MAX_BLOCKS = 400;
const MAX_SPANS_PER_BLOCK = 200;

type InertSpan =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "strong"; readonly text: string }
  | { readonly kind: "emphasis"; readonly text: string };

type InertBlock =
  | { readonly kind: "paragraph"; readonly spans: readonly InertSpan[] }
  | {
      readonly kind: "heading";
      readonly level: number;
      readonly spans: readonly InertSpan[];
    }
  | {
      readonly kind: "list";
      readonly ordered: boolean;
      readonly items: readonly (readonly InertSpan[])[];
    }
  | { readonly kind: "quote"; readonly spans: readonly InertSpan[] }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "rule" }
  | { readonly kind: "notice"; readonly text: string };

function pushText(spans: InertSpan[], text: string) {
  if (text.length === 0) return;
  const last = spans[spans.length - 1];
  if (last && last.kind === "text") {
    spans[spans.length - 1] = { kind: "text", text: last.text + text };
    return;
  }
  spans.push({ kind: "text", text });
}

/**
 * Emphasis, strong, and inline code only. Link and image syntax is deliberately
 * not a token: it stays exactly as the model wrote it.
 */
function parseInertSpans(line: string): readonly InertSpan[] {
  const spans: InertSpan[] = [];
  let index = 0;
  while (index < line.length && spans.length < MAX_SPANS_PER_BLOCK) {
    const character = line[index] as string;
    if (character === "`") {
      const end = line.indexOf("`", index + 1);
      if (end > index + 1) {
        spans.push({ kind: "code", text: line.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }
    if (character === "*" && line.startsWith("**", index)) {
      const end = line.indexOf("**", index + 2);
      if (end > index + 2) {
        spans.push({ kind: "strong", text: line.slice(index + 2, end) });
        index = end + 2;
        continue;
      }
    }
    if (character === "*" || character === "_") {
      const end = line.indexOf(character, index + 1);
      if (end > index + 1 && !line.slice(index + 1, end).includes(" ")) {
        spans.push({ kind: "emphasis", text: line.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }
    pushText(spans, character);
    index += 1;
  }
  if (index < line.length) pushText(spans, line.slice(index));
  return spans;
}

const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/;
const UNORDERED_ITEM_PATTERN = /^\s{0,3}[-*+]\s+(.*)$/;
const ORDERED_ITEM_PATTERN = /^\s{0,3}\d{1,3}[.)]\s+(.*)$/;
const RULE_PATTERN = /^\s{0,3}([-*_])\1{2,}\s*$/;

export type AthenaAgentSafeTextMode = "answer" | "provisional";

/** Parse untrusted text into the closed block vocabulary this module renders. */
function parseInertBlocks(
  text: string,
  maxCharacters = DEFAULT_MAX_CHARACTERS,
  mode: AthenaAgentSafeTextMode = "answer",
): readonly InertBlock[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const bounded = normalized.slice(0, maxCharacters);
  const truncated = bounded.length < normalized.length;
  const lines = bounded.split("\n");
  const blocks: InertBlock[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", spans: parseInertSpans(paragraph.join("\n")) });
    paragraph = [];
  };

  let index = 0;
  while (index < lines.length && blocks.length < MAX_BLOCKS) {
    const line = lines[index] as string;

    if (/^\s{0,3}```/.test(line)) {
      flushParagraph();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s{0,3}```/.test(lines[index] as string)) {
        body.push(lines[index] as string);
        index += 1;
      }
      index += 1;
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }

    if (line.trim().length === 0) {
      flushParagraph();
      index += 1;
      continue;
    }

    if (RULE_PATTERN.test(line)) {
      flushParagraph();
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }

    const heading = HEADING_PATTERN.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({
        kind: "heading",
        level: (heading[1] as string).length,
        spans: parseInertSpans(heading[2] as string),
      });
      index += 1;
      continue;
    }

    const isOrdered = ORDERED_ITEM_PATTERN.test(line);
    const isUnordered = UNORDERED_ITEM_PATTERN.test(line);
    if (isOrdered || isUnordered) {
      flushParagraph();
      const pattern = isOrdered ? ORDERED_ITEM_PATTERN : UNORDERED_ITEM_PATTERN;
      const items: (readonly InertSpan[])[] = [];
      while (index < lines.length) {
        const match = pattern.exec(lines[index] as string);
        if (!match) break;
        items.push(parseInertSpans(match[1] as string));
        index += 1;
      }
      blocks.push({ kind: "list", ordered: isOrdered, items });
      continue;
    }

    if (/^\s{0,3}>/.test(line)) {
      flushParagraph();
      const quoted: string[] = [];
      while (index < lines.length && /^\s{0,3}>/.test(lines[index] as string)) {
        quoted.push((lines[index] as string).replace(/^\s{0,3}>\s?/, ""));
        index += 1;
      }
      blocks.push({ kind: "quote", spans: parseInertSpans(quoted.join("\n")) });
      continue;
    }

    paragraph.push(line);
    index += 1;
  }
  flushParagraph();

  if (truncated || index < lines.length) {
    blocks.push({ kind: "notice", text: describeAthenaShortenedNotice(mode) });
  }
  return mode === "provisional" ? flattenForDraft(blocks) : blocks;
}

/**
 * The provisional vocabulary: paragraphs, lists, inline spans, and the
 * renderer's own notice. A rule is dropped, a heading and a quotation become
 * paragraphs, and a fenced block becomes one plain-text paragraph — its body is
 * never re-parsed, so nothing inside it can become a span either.
 */
function flattenForDraft(blocks: readonly InertBlock[]): readonly InertBlock[] {
  return blocks.flatMap<InertBlock>((block) => {
    if (block.kind === "rule") return [];
    if (block.kind === "heading" || block.kind === "quote") {
      return [{ kind: "paragraph", spans: block.spans }];
    }
    if (block.kind === "code") {
      return [{ kind: "paragraph", spans: [{ kind: "text", text: block.text }] }];
    }
    return [block];
  });
}

function renderSpans(spans: readonly InertSpan[]): ReactNode {
  return spans.map((span, spanIndex) => {
    const key = `${span.kind}-${spanIndex}`;
    if (span.kind === "code") {
      return (
        <code
          className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.85em]"
          key={key}
        >
          {span.text}
        </code>
      );
    }
    if (span.kind === "strong") {
      return (
        <strong className="font-semibold text-foreground" key={key}>
          {span.text}
        </strong>
      );
    }
    if (span.kind === "emphasis") {
      return (
        <em className="italic" key={key}>
          {span.text}
        </em>
      );
    }
    // A plain string child: no element, no attribute, nothing to hang a
    // handler on.
    return span.text;
  });
}

function headingTag(level: number) {
  if (level <= 1) return "h4" as const;
  if (level === 2) return "h5" as const;
  return "h6" as const;
}

export type AthenaAgentSafeTextProps = {
  readonly text: string;
  readonly className?: string;
  readonly maxCharacters?: number;
  /** `provisional` renders a draft the model is still writing. */
  readonly mode?: AthenaAgentSafeTextMode;
};

/** Render untrusted narrative. Emits text nodes only — never a link or an asset. */
export function AthenaAgentSafeText({
  text,
  className,
  maxCharacters,
  mode = "answer",
}: AthenaAgentSafeTextProps) {
  // Parsed from the whole buffer on every render: a draft grows by prefix, and
  // a memoized parse would let a payload complete itself between frames.
  const blocks = parseInertBlocks(text, maxCharacters, mode);

  return (
    <div className={cn("space-y-layout-sm text-sm leading-6 text-foreground", className)}>
      {blocks.map((block, blockIndex) => {
        const key = `${block.kind}-${blockIndex}`;
        if (block.kind === "heading") {
          const Tag = headingTag(block.level);
          return (
            <Tag className="text-sm font-semibold text-foreground" key={key}>
              {renderSpans(block.spans)}
            </Tag>
          );
        }
        if (block.kind === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag
              className={cn(
                "space-y-1 pl-5",
                block.ordered ? "list-decimal" : "list-disc",
              )}
              key={key}
            >
              {block.items.map((item, itemIndex) => (
                <li key={`item-${itemIndex}`}>{renderSpans(item)}</li>
              ))}
            </ListTag>
          );
        }
        if (block.kind === "quote") {
          return (
            <blockquote
              className="border-l-2 border-border pl-3 text-muted-foreground"
              key={key}
            >
              <p className="whitespace-pre-wrap">{renderSpans(block.spans)}</p>
            </blockquote>
          );
        }
        if (block.kind === "code") {
          return (
            <pre
              className="overflow-x-auto rounded-md bg-muted p-3 text-xs"
              key={key}
            >
              <code className="font-mono">{block.text}</code>
            </pre>
          );
        }
        if (block.kind === "rule") {
          return <hr className="border-border" key={key} />;
        }
        if (block.kind === "notice") {
          return (
            <p className="text-xs text-muted-foreground" key={key}>
              {block.text}
            </p>
          );
        }
        return (
          <p className="whitespace-pre-wrap" key={key}>
            {renderSpans(block.spans)}
          </p>
        );
      })}
    </div>
  );
}
