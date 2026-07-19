export const serviceWorkspaceDemoGuidance =
  "This workspace is for interaction only in the demo. Actions are disabled.";

export function ServiceWorkspaceDemoNotice({
  isSharedDemo,
}: {
  isSharedDemo: boolean;
}) {
  if (!isSharedDemo) {
    return null;
  }

  return (
    <aside
      aria-label="Demo guidance"
      className="w-fit max-w-full rounded-md border border-border bg-muted/40 px-layout-md py-layout-sm"
    >
      <p className="text-sm leading-6 text-muted-foreground">
        {serviceWorkspaceDemoGuidance}
      </p>
    </aside>
  );
}
