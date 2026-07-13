import { useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Id } from "~/convex/_generated/dataModel";

const listStaffMessages = makeFunctionReference<"query", "public", { storeId: Id<"store"> }, Array<{ _id: Id<"staffMessage">; authorUserId: Id<"athenaUser">; body: string; createdAt: number }>>("operations/staffMessages:listStaffMessages");
const postStaffMessage = makeFunctionReference<"mutation", "public", { body: string; expectedDemoRestoreEpoch?: number; storeId: Id<"store"> }, unknown>("operations/staffMessages:postStaffMessage");
const getSharedDemoContext = makeFunctionReference<"query", "public", Record<string, never>, { kind: "shared_demo"; restore: { epoch: number } } | null>("sharedDemo/public:getContext");

export function StaffMessagesView({ storeId }: { storeId: Id<"store"> }) {
  const messages = useQuery(listStaffMessages, { storeId });
  const demo = useQuery(getSharedDemoContext, {});
  const post = useMutation(postStaffMessage);
  const [body, setBody] = useState("");
  const [status, setStatus] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setStatus("Posting…");
    try {
      await post({ body, storeId, ...(demo ? { expectedDemoRestoreEpoch: demo.restore.epoch } : {}) });
      setBody("");
      setStatus("Posted for the store team.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The message could not be posted.");
    }
  };

  return (
    <main className="mx-auto w-full max-w-3xl space-y-layout-lg p-layout-lg">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Store team</p>
        <h1 className="mt-layout-xs font-display text-3xl font-light">Staff messages</h1>
        <p className="mt-layout-sm text-muted-foreground">Leave short operational context for everyone running this store.</p>
      </header>
      <form className="space-y-layout-sm" onSubmit={submit}>
        <label className="text-sm font-medium" htmlFor="staff-message">Message</label>
        <Textarea id="staff-message" maxLength={500} required value={body} onChange={(event) => setBody(event.target.value)} />
        <div className="flex items-center justify-between gap-layout-md"><span className="text-xs text-muted-foreground">{body.length}/500</span><Button type="submit" disabled={!body.trim()}>Post message</Button></div>
        <p aria-live="polite" className="text-sm text-muted-foreground">{status}</p>
      </form>
      <section aria-labelledby="staff-message-history"><h2 id="staff-message-history" className="font-display text-xl">Recent messages</h2>
        <ol className="mt-layout-md space-y-layout-sm">{messages?.map((message) => <li key={message._id} className="rounded-md border border-border p-layout-md"><p className="whitespace-pre-wrap text-sm">{message.body}</p><time className="mt-layout-xs block text-xs text-muted-foreground" dateTime={new Date(message.createdAt).toISOString()}>{new Date(message.createdAt).toLocaleString()}</time></li>)}</ol>
      </section>
    </main>
  );
}
