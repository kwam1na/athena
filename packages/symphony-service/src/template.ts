import { Liquid } from "liquidjs";
import { SymphonyError } from "./errors";
import type { PromptTemplateInput } from "./types";

const liquid = new Liquid({
  strictVariables: true,
  strictFilters: true,
});

export async function renderPromptTemplate(template: string, input: PromptTemplateInput): Promise<string> {
  let parsed: ReturnType<Liquid["parse"]>;
  try {
    parsed = liquid.parse(template);
  } catch (error) {
    throw new SymphonyError("template_parse_error", "failed to parse workflow prompt template", { cause: error });
  }

  try {
    return await liquid.render(parsed, input);
  } catch (error) {
    throw new SymphonyError("template_render_error", "failed to render workflow prompt template", { cause: error });
  }
}

export async function buildIssuePrompt(template: string, input: PromptTemplateInput): Promise<string> {
  if (!template.trim()) {
    return "You are working on an issue from Linear.";
  }

  return await renderPromptTemplate(template.trim(), input);
}
