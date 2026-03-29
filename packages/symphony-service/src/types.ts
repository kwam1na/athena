export type WorkflowConfigMap = Record<string, unknown>;

export interface WorkflowDocument {
  path: string;
  config: WorkflowConfigMap;
  promptTemplate: string;
}

export interface IssueTemplateInput {
  id: string;
  identifier: string;
  title: string;
  state: string;
  priority?: number | null;
  labels?: string[];
  blocked_by?: string[];
  created_at?: string;
  updated_at?: string;
}

export interface PromptTemplateInput {
  issue: IssueTemplateInput;
  attempt?: number | null;
}

export interface EffectiveConfig {
  tracker: {
    kind: string;
    endpoint: string;
    apiKey?: string;
    projectSlug?: string;
    activeStates: string[];
    terminalStates: string[];
  };
  polling: {
    intervalMs: number;
  };
  workspace: {
    root: string;
  };
  hooks: {
    afterCreate?: string;
    beforeRun?: string;
    afterRun?: string;
    beforeRemove?: string;
    timeoutMs: number;
  };
  agent: {
    maxConcurrentAgents: number;
    maxRetryBackoffMs: number;
    maxTurns: number;
    maxConcurrentAgentsByState: Record<string, number>;
  };
  codex: {
    command: string;
    approvalPolicy?: unknown;
    threadSandbox?: unknown;
    turnSandboxPolicy?: unknown;
    turnTimeoutMs: number;
    readTimeoutMs: number;
    stallTimeoutMs: number;
  };
}
