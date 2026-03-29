export interface IssueBlocker {
  id: string;
  identifier: string;
  state: string;
}

export interface NormalizedIssue {
  id: string;
  identifier: string;
  title: string;
  state: string;
  priority: number | null;
  created_at: string;
  updated_at: string;
  labels: string[];
  blocked_by: IssueBlocker[];
}

export interface TrackerClient {
  fetchCandidateIssues(): Promise<NormalizedIssue[]>;
  fetchIssuesByStates(stateNames: string[]): Promise<NormalizedIssue[]>;
  fetchIssueStatesByIds(issueIds: string[]): Promise<NormalizedIssue[]>;
}
