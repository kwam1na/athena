export function getSharedDemoEntryPresentation({
  enabled,
  failed,
}: {
  enabled: boolean;
  failed: boolean;
}) {
  if (!enabled) {
    return {
      detail: "Open the demo from an approved development or QA environment.",
      title: "The demo is not available here.",
    };
  }
  if (failed) {
    return {
      detail: "Athena could not open the synthetic store. Try again in a moment.",
      title: "The demo is not available right now.",
    };
  }
  return {
    detail: "No account or credentials are needed. This may take a few seconds.",
    title: "Opening the demo store…",
  };
}
