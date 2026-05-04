import {
  StorybookCallout,
  StorybookList,
  StorybookPillRow,
  StorybookSection,
  StorybookShell,
} from "../storybook-shell";

export function AthenaGuidanceIntroductionPage() {
  return (
    <StorybookShell
      eyebrow="Guidance"
      title="Athena rollout guidance"
      description="Written guidance keeps the reference templates and future rollout work aligned on what Athena cards, typography, density, shell composition, and motion should look like."
    >
      <StorybookCallout title="How to use this guidance">
        Treat these notes as implementation rules for Storybook-first system work. They are
        intentionally opinionated so future templates stay consistent even when the surfaces are
        different.
      </StorybookCallout>

      <StorybookSection
        title="Card usage"
        description="Cards should frame information that belongs together; they should not become a default layout wrapper."
      >
        <StorybookPillRow items={["Group related content", "Keep actions secondary", "Let the heading lead"]} />
        <StorybookList
          items={[
            "Use cards for a bounded decision, a summary, or a coherent data block.",
            "Avoid nesting cards inside cards unless the inner card is a genuine sub-decision.",
            "Prefer a shared card rhythm across dashboards, data views, and settings so the page feels authored instead of assembled.",
          ]}
        />
      </StorybookSection>

      <StorybookSection
        title="Typography"
        description="Display type belongs on anchors and key numerics; the UI sans should carry the working copy."
      >
        <StorybookList
          items={[
            "Use the display family for page titles, hero numerics, and section landmarks.",
            "Keep controls, helper text, and dense table content in the UI sans.",
            "Do not mix expressive heading styles within the same page unless the hierarchy truly changes.",
          ]}
        />
      </StorybookSection>

      <StorybookSection
        title="Density"
        description="Density should be intentional: standard for orientation, compact for comparison."
      >
        <StorybookList
          items={[
            "Reserve compact density for tables, filter lanes, and review-heavy operational surfaces.",
            "Keep forms and overview pages in the standard rhythm so they remain approachable.",
            "If a page is hard to read in compact mode, the layout is probably trying to do too much.",
          ]}
        />
      </StorybookSection>

      <StorybookSection
        title="Shell composition"
        description="The shell should anchor the workspace with hierarchy, then step aside for the page content."
      >
        <StorybookList
          items={[
            "Keep the shell, page header, and workspace sections visually distinct.",
            "Use the page-level header pattern for orientation: uppercase eyebrow, large display title, restrained description, and a quiet divider.",
            "Use left-rail navigation or a strong top-level header to stabilize orientation.",
            "Let content blocks breathe enough that the review surface never feels crammed edge to edge.",
          ]}
        />
      </StorybookSection>

      <StorybookSection
        title="Flow detail pattern"
        description="Flow detail views should keep stable context visible while giving the active work enough room to breathe."
      >
        <StorybookPillRow
          items={[
            "Context summary card",
            "Status-first context",
            "Large working canvas",
          ]}
        />
        <StorybookList
          items={[
            "Use a narrow rail for stable flow context, current state, ownership, key dates, totals, or next actions.",
            "Use a large working canvas for editable records, review queues, audit trails, traces, line items, or supporting detail.",
            "Keep card borders quiet, corners generous, and shadows soft so the layout feels deliberate without becoming decorative.",
            "Separate card headers and content with a light rule when the top area carries state, progress, or a primary summary.",
            "Use uppercase micro-labels only for section identity or totals; keep field labels sentence case and values right-aligned where comparison matters.",
          ]}
        />
      </StorybookSection>

      <StorybookSection
        title="Restrained motion"
        description="Motion should guide attention, not perform for its own sake."
      >
        <StorybookList
          items={[
            "Use short motion for focus, overlays, and status changes only.",
            "Avoid decorative easing that makes the workspace feel lively instead of useful.",
            "If motion obscures the hierarchy, it is too strong for Athena.",
          ]}
        />
      </StorybookSection>
    </StorybookShell>
  );
}
