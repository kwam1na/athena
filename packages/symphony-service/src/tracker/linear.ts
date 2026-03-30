import { SymphonyError } from "../errors";
import type { NormalizedIssue, TrackerClient } from "../issue";

const CANDIDATE_QUERY = `
query FetchCandidateIssues($projectSlug: String!, $activeStates: [String!], $after: String, $first: Int!) {
  issues(
    filter: {
      project: { slugId: { eq: $projectSlug } }
      state: { name: { in: $activeStates } }
    }
    first: $first
    after: $after
  ) {
    nodes {
      id
      identifier
      title
      priority
      createdAt
      updatedAt
      state { name }
      labels { nodes { name } }
      relations {
        nodes {
          type
          relatedIssue {
            id
            identifier
            state { name }
          }
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
`;

const BY_STATES_QUERY = `
query FetchIssuesByStates($projectSlug: String!, $states: [String!], $after: String, $first: Int!) {
  issues(
    filter: {
      project: { slugId: { eq: $projectSlug } }
      state: { name: { in: $states } }
    }
    first: $first
    after: $after
  ) {
    nodes {
      id
      identifier
      title
      priority
      createdAt
      updatedAt
      state { name }
      labels { nodes { name } }
      relations {
        nodes {
          type
          relatedIssue {
            id
            identifier
            state { name }
          }
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
`;

const BY_IDS_QUERY = `
query FetchIssueStatesByIds($issueIds: [ID!]!) {
  issues(filter: { id: { in: $issueIds } }, first: 250) {
    nodes {
      id
      identifier
      title
      priority
      createdAt
      updatedAt
      state { name }
      labels { nodes { name } }
      relations {
        nodes {
          type
          relatedIssue {
            id
            identifier
            state { name }
          }
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
`;

interface LinearClientOptions {
  endpoint: string;
  apiKey: string;
  projectSlug: string;
  activeStates: string[];
  timeoutMs?: number;
  pageSize?: number;
  fetchImpl?: typeof fetch;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

interface IssueConnection {
  issues?: {
    nodes?: unknown[];
    pageInfo?: {
      hasNextPage?: boolean;
      endCursor?: string | null;
    };
  };
}

export class LinearTrackerClient implements TrackerClient {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly projectSlug: string;
  private readonly activeStates: string[];
  private readonly timeoutMs: number;
  private readonly pageSize: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: LinearClientOptions) {
    this.endpoint = options.endpoint;
    this.apiKey = options.apiKey;
    this.projectSlug = options.projectSlug;
    this.activeStates = options.activeStates;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.pageSize = options.pageSize ?? 50;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async fetchCandidateIssues(): Promise<NormalizedIssue[]> {
    return await this.fetchPaginatedIssues(CANDIDATE_QUERY, {
      projectSlug: this.projectSlug,
      activeStates: this.activeStates,
    });
  }

  async fetchIssuesByStates(stateNames: string[]): Promise<NormalizedIssue[]> {
    if (stateNames.length === 0) {
      return [];
    }

    return await this.fetchPaginatedIssues(BY_STATES_QUERY, {
      projectSlug: this.projectSlug,
      states: stateNames,
    });
  }

  async fetchIssueStatesByIds(issueIds: string[]): Promise<NormalizedIssue[]> {
    if (issueIds.length === 0) {
      return [];
    }

    const response = await this.graphqlRequest<IssueConnection>(BY_IDS_QUERY, {
      issueIds,
    });

    const nodes = response.issues?.nodes;
    if (!Array.isArray(nodes)) {
      throw new SymphonyError("linear_unknown_payload", "Linear response missing issues.nodes for id-based fetch");
    }

    return nodes.map(normalizeIssue).filter((issue): issue is NormalizedIssue => issue !== null);
  }

  private async fetchPaginatedIssues(
    query: string,
    baseVariables: Record<string, unknown>,
  ): Promise<NormalizedIssue[]> {
    const all: NormalizedIssue[] = [];
    let after: string | null = null;

    while (true) {
      const response: IssueConnection = await this.graphqlRequest<IssueConnection>(query, {
        ...baseVariables,
        after,
        first: this.pageSize,
      });

      const connection: IssueConnection["issues"] = response.issues;
      const nodes = connection?.nodes;
      const pageInfo: NonNullable<IssueConnection["issues"]>["pageInfo"] = connection?.pageInfo;

      if (!Array.isArray(nodes) || !pageInfo) {
        throw new SymphonyError("linear_unknown_payload", "Linear response missing issues connection fields");
      }

      const normalized = nodes.map(normalizeIssue).filter((issue): issue is NormalizedIssue => issue !== null);
      all.push(...normalized);

      const hasNextPage = Boolean(pageInfo.hasNextPage);
      const endCursor: string | null = pageInfo.endCursor ?? null;

      if (!hasNextPage) {
        return all;
      }

      if (!endCursor) {
        throw new SymphonyError("linear_missing_end_cursor", "Linear response hasNextPage=true but no endCursor");
      }

      after = endCursor;
    }
  }

  private async graphqlRequest<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: this.apiKey,
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      throw new SymphonyError("linear_api_request", "Linear request failed", { cause: error });
    }

    clearTimeout(timer);

    if (!response.ok) {
      throw new SymphonyError("linear_api_status", `Linear API returned non-200 status: ${response.status}`);
    }

    let payload: GraphQLResponse<T>;
    try {
      payload = (await response.json()) as GraphQLResponse<T>;
    } catch (error) {
      throw new SymphonyError("linear_unknown_payload", "Linear response was not valid JSON", { cause: error });
    }

    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      const firstError = payload.errors[0]?.message || "unknown GraphQL error";
      throw new SymphonyError("linear_graphql_errors", `Linear GraphQL returned errors: ${firstError}`);
    }

    if (!payload.data) {
      throw new SymphonyError("linear_unknown_payload", "Linear response missing data field");
    }

    return payload.data;
  }
}

function normalizeIssue(raw: unknown): NormalizedIssue | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const node = raw as Record<string, unknown>;
  const id = asString(node.id);
  const identifier = asString(node.identifier);
  const title = asString(node.title);
  const state = asString((node.state as { name?: unknown } | undefined)?.name);

  if (!id || !identifier || !title || !state) {
    return null;
  }

  return {
    id,
    identifier,
    title,
    state,
    priority: normalizePriority(node.priority),
    created_at: normalizeIso(node.createdAt),
    updated_at: normalizeIso(node.updatedAt),
    labels: normalizeLabels((node.labels as { nodes?: unknown[] } | undefined)?.nodes),
    blocked_by: normalizeBlockedBy((node.relations as { nodes?: unknown[] } | undefined)?.nodes),
  };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizePriority(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  return null;
}

function normalizeIso(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    return "";
  }

  return new Date(ms).toISOString();
}

function normalizeLabels(value: unknown[] | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (item && typeof item === "object" ? asString((item as { name?: unknown }).name) : ""))
    .filter((name) => name.length > 0)
    .map((name) => name.toLowerCase());
}

function normalizeBlockedBy(value: unknown[] | undefined): Array<{ id: string; identifier: string; state: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  const blockers: Array<{ id: string; identifier: string; state: string }> = [];

  for (const relationRaw of value) {
    if (!relationRaw || typeof relationRaw !== "object") {
      continue;
    }

    const relation = relationRaw as {
      type?: unknown;
      relationType?: unknown;
      relatedIssue?: {
        id?: unknown;
        identifier?: unknown;
        state?: { name?: unknown };
      };
    };

    const relationType = asString(relation.type || relation.relationType);
    if (relationType !== "blocks") {
      continue;
    }

    const related = relation.relatedIssue;
    if (!related) {
      continue;
    }

    const id = asString(related.id);
    const identifier = asString(related.identifier);
    const state = asString(related.state?.name);

    if (id && identifier && state) {
      blockers.push({ id, identifier, state });
    }
  }

  return blockers;
}
