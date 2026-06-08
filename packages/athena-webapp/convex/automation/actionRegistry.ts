export type AutomationDomain = string;
export type AutomationAction = string;
export type AutomationPolicyMode = "disabled" | "dry_run" | "enabled";
export type AutomationRunOutcome =
  | "disabled"
  | "dry_run"
  | "skipped"
  | "prepared"
  | "eligible"
  | "applied"
  | "failed";

export type AutomationActionDefinition = {
  domain: AutomationDomain;
  action: AutomationAction;
  triggerType: string;
  allowedOutcomes: AutomationRunOutcome[];
  mutationBoundary: string;
  requiresSourceSubjects: boolean;
};

export function automationActionKey(args: {
  action: AutomationAction;
  domain: AutomationDomain;
}) {
  return `${args.domain}.${args.action}`;
}

export function defineAutomationAction(
  definition: AutomationActionDefinition,
) {
  if (!definition.domain.trim()) {
    throw new Error("Automation action domain is required.");
  }

  if (!definition.action.trim()) {
    throw new Error("Automation action name is required.");
  }

  if (definition.allowedOutcomes.length === 0) {
    throw new Error("Automation action must allow at least one outcome.");
  }

  return definition;
}

export function registerAutomationActions(
  definitions: AutomationActionDefinition[],
) {
  const actions = new Map<string, AutomationActionDefinition>();

  for (const definition of definitions) {
    const action = defineAutomationAction(definition);
    const key = automationActionKey(action);

    if (actions.has(key)) {
      throw new Error(`Automation action already registered: ${key}`);
    }

    actions.set(key, action);
  }

  return actions;
}
