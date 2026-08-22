/**
 * Opaque runtime references and component lookups for the Convex Agent
 * adapter. Environment-neutral (no runtime-native imports beyond the
 * component's generated API type), so the V8 mutation side — the harness
 * retention cleanup hook — can resolve refs and delete runtime payloads without loading
 * the Node-only adapter.
 *
 * Tokens: `th_<40 hex>` for threads (SHA-256 of the Athena thread key);
 * `in_|tn_|pj_<thread token>.<24 hex>` for inputs, turns, and projections, so
 * any ref is self-locating from the ref alone. None can be mistaken for a raw
 * document id, and component ids never leave this directory.
 */
import type { AgentComponent } from "@convex-dev/agent";
import type { GenericActionCtx, GenericDataModel } from "convex/server";

import { opaqueRef, parseOpaqueRef } from "../../../shared/agentHarness/values";
import type { RuntimeThreadRef } from "../../../shared/agentHarness/agentRuntime";

type BaseActionCtx = GenericActionCtx<GenericDataModel>;

/** Query/mutation reach is enough for thread, input, projection, and cleanup; turns need the action pieces too. */
export type ConvexAgentRuntimeCtx = Pick<BaseActionCtx, "runQuery" | "runMutation"> &
  Partial<Pick<BaseActionCtx, "runAction" | "storage" | "auth">>;

export type ConvexAgentScopedRefKind = "runtime_input" | "runtime_turn" | "runtime_projection";

export type ComponentMessage = {
  readonly _id: string;
  readonly status: "pending" | "success" | "failed";
  readonly providerMetadata?: Record<string, Record<string, unknown>>;
  readonly threadId: string;
};

export type ThreadState = { readonly token: string; readonly threadRef: RuntimeThreadRef; readonly threadId: string };

export const CONVEX_AGENT_MESSAGE_LOOKUP_PAGE = 200;

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function mintThreadToken(threadKey: string): Promise<string> {
  return `th_${(await sha256Hex(threadKey)).slice(0, 40)}`;
}

export async function mintScopedToken(prefix: "in" | "tn" | "pj", threadToken: string, ...parts: string[]): Promise<string> {
  return `${prefix}_${threadToken}.${(await sha256Hex(parts.join(" "))).slice(0, 24)}`;
}

export function threadTokenOfScopedToken(token: string): string | undefined {
  const match = /^(?:in|tn|pj)_(th_[0-9a-f]{40})\.[0-9a-f]{24}$/.exec(token);
  return match?.[1];
}

export function tokenOf(ref: string, kind: "runtime_thread" | ConvexAgentScopedRefKind): string | undefined {
  const parsed = parseOpaqueRef(ref);
  return parsed && parsed.kind === kind ? parsed.token : undefined;
}

/** Convex Agent `userId` is correlation metadata only, never authorization. */
export function correlationUserId(threadToken: string): string {
  return `athena:thread:${threadToken}`;
}

/** The component does not persist a caller-supplied `id`; Athena's token lives in `providerMetadata.athena.token`. */
export function tokenOfMessage(message: ComponentMessage): string | undefined {
  const token = (message.providerMetadata?.athena as { token?: unknown } | undefined)?.token;
  return typeof token === "string" ? token : undefined;
}

export function athenaMetadataOf(message: { providerMetadata?: Record<string, Record<string, unknown>> }): Record<string, unknown> | undefined {
  return message.providerMetadata?.athena;
}

export function createComponentLookups(ctx: ConvexAgentRuntimeCtx, component: AgentComponent) {
  const threadsByRef = new Map<RuntimeThreadRef, ThreadState>();

  const findThread = async (threadToken: string): Promise<string | undefined> => {
    const page = await ctx.runQuery(component.threads.listThreadsByUserId, {
      userId: correlationUserId(threadToken),
      order: "asc",
      paginationOpts: { cursor: null, numItems: 1 },
    });
    return page.page[0]?._id;
  };

  const listMessages = async (threadId: string): Promise<ComponentMessage[]> => {
    const page = await ctx.runQuery(component.messages.listMessagesByThreadId, {
      threadId,
      order: "desc",
      statuses: ["pending", "success", "failed"],
      paginationOpts: { cursor: null, numItems: CONVEX_AGENT_MESSAGE_LOOKUP_PAGE },
    });
    return page.page as unknown as ComponentMessage[];
  };

  const findMessageByToken = async (threadId: string, token: string): Promise<ComponentMessage | undefined> => {
    const messages = await listMessages(threadId);
    return messages.find((message) => tokenOfMessage(message) === token);
  };

  const resolveThreadByToken = async (token: string): Promise<ThreadState | undefined> => {
    const threadRef = opaqueRef("runtime_thread", token);
    const cached = threadsByRef.get(threadRef);
    if (cached) return cached;
    const threadId = await findThread(token);
    if (!threadId) return undefined;
    const state: ThreadState = { token, threadRef, threadId };
    threadsByRef.set(threadRef, state);
    return state;
  };

  const resolveThread = async (threadRef: RuntimeThreadRef): Promise<ThreadState | undefined> => {
    const token = tokenOf(threadRef, "runtime_thread");
    return token ? resolveThreadByToken(token) : undefined;
  };

  /** Locate the thread an input/turn/projection ref belongs to, from the ref alone. */
  const resolveThreadOfScopedRef = async (ref: string, kind: ConvexAgentScopedRefKind): Promise<ThreadState | undefined> => {
    const token = tokenOf(ref, kind);
    const threadToken = token ? threadTokenOfScopedToken(token) : undefined;
    return threadToken ? resolveThreadByToken(threadToken) : undefined;
  };

  return { threadsByRef, findThread, listMessages, findMessageByToken, resolveThread, resolveThreadOfScopedRef };
}

export type ComponentLookups = ReturnType<typeof createComponentLookups>;

export type PersistedMessageSummary = {
  readonly kind: unknown;
  readonly role: string;
  readonly status: string;
  readonly textBytes: number;
  readonly hasToolParts: boolean;
  readonly metadataKeys: readonly string[];
};

/**
 * Allowlisted persistence inspection for smoke/evidence reports: shapes and
 * sizes of what the component holds for a thread, never message content.
 */
export async function summarizePersistedThread(
  ctx: ConvexAgentRuntimeCtx,
  component: AgentComponent,
  threadRef: RuntimeThreadRef,
): Promise<{ threads: number; messages: PersistedMessageSummary[] }> {
  const token = tokenOf(threadRef, "runtime_thread");
  if (!token) return { threads: 0, messages: [] };
  const threadPage = await ctx.runQuery(component.threads.listThreadsByUserId, {
    userId: correlationUserId(token),
    paginationOpts: { cursor: null, numItems: 2 },
  });
  const messages: PersistedMessageSummary[] = [];
  for (const threadDoc of threadPage.page) {
    const page = await ctx.runQuery(component.messages.listMessagesByThreadId, {
      threadId: threadDoc._id,
      order: "asc",
      statuses: ["pending", "success", "failed"],
      paginationOpts: { cursor: null, numItems: 50 },
    });
    for (const message of page.page) {
      const content = message.message?.content;
      const parts = Array.isArray(content) ? content : [];
      messages.push({
        kind: (message.providerMetadata?.athena as { kind?: unknown } | undefined)?.kind,
        role: message.message?.role ?? "unknown",
        status: message.status,
        textBytes: new TextEncoder().encode(message.text ?? "").length,
        hasToolParts:
          message.tool === true || parts.some((part) => typeof part === "object" && part !== null && /tool/.test(String((part as { type?: unknown }).type))),
        metadataKeys: Object.keys((message.providerMetadata?.athena as Record<string, unknown> | undefined) ?? {}).sort(),
      });
    }
  }
  return { threads: threadPage.page.length, messages };
}
