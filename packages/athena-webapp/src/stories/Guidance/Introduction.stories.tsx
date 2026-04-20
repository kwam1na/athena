import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  StorybookCallout,
  StorybookList,
  StorybookPillRow,
  StorybookSection,
  StorybookShell,
} from "../storybook-shell";

function IntroductionPage() {
  return (
    <StorybookShell
      eyebrow="Athena Webapp"
      title="Design system workspace"
      description="Storybook is the review surface for Athena's foundations, primitives, shell patterns, templates, and guidance. This first ticket establishes the workspace and its hierarchy so the next tickets can fill it with authored system coverage."
    >
      <StorybookSection
        title="Structure"
        description="The hierarchy mirrors the approved rollout: foundations first, then primitives, then patterns, templates, and guidance."
      >
        <StorybookPillRow
          items={["Foundations", "Primitives", "Patterns", "Templates", "Guidance"]}
        />
        <StorybookList
          items={[
            "Foundations will hold semantic tokens for color, type, spacing, density, and motion.",
            "Primitives will document the shared UI contracts Athena relies on every day.",
            "Patterns will capture the admin shell language that makes Athena feel distinct.",
            "Templates and guidance will help future rollout work stay aligned.",
          ]}
        />
      </StorybookSection>

      <StorybookSection
        title="Preview contract"
        description="Stories render with Athena global CSS, app aliases, and a light or dark theme toolbar, but without live router, auth, or Convex dependencies."
      >
        <StorybookCallout title="What this ticket establishes">
          A theme-aware Storybook shell, package-local scripts, curated addons, and a clean story hierarchy that future tickets can build on without inheriting demo clutter.
        </StorybookCallout>
      </StorybookSection>
    </StorybookShell>
  );
}

const meta = {
  title: "Guidance/Introduction",
  component: IntroductionPage,
  parameters: {
    docs: {
      description: {
        component:
          "Overview of the Athena design-system Storybook structure and what this first ticket is responsible for.",
      },
    },
  },
} satisfies Meta<typeof IntroductionPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Overview: Story = {};
