import type { Decorator, Preview } from "@storybook/react-vite";
import type { CSSProperties } from "react";

const radiusTokenOptions = [
  { value: "none", title: "None · 0px", radius: "0rem" },
  { value: "tight", title: "Tight · 2px", radius: "0.125rem" },
  { value: "standard", title: "Standard · 4px", radius: "0.25rem" },
  { value: "comfortable", title: "Comfortable · 8px", radius: "0.5rem" },
  { value: "generous", title: "Generous · 12px", radius: "0.75rem" },
  { value: "round", title: "Round · 16px", radius: "1rem" },
] as const;

type RadiusTokenName = (typeof radiusTokenOptions)[number]["value"];

const radiusTokenMap = new Map(
  radiusTokenOptions.map((option) => [option.value, option.radius]),
);

type AthenaDesignTokenStyle = CSSProperties & {
  "--radius"?: string;
};

export const athenaThemeGlobalType: NonNullable<Preview["globalTypes"]>["theme"] =
  {
    description: "Preview Athena stories in light or dark mode.",
    toolbar: {
      title: "Theme",
      icon: "mirror",
      items: [
        { value: "light", title: "Light" },
        { value: "dark", title: "Dark" },
      ],
      dynamicTitle: true,
    },
  };

export const athenaRadiusGlobalType: NonNullable<
  Preview["globalTypes"]
>["radius"] = {
  description: "Tune the root radius token used by cards, panels, controls, and overlays.",
  toolbar: {
    title: "Radius",
    icon: "circlehollow",
    items: radiusTokenOptions.map(({ value, title }) => ({ value, title })),
    dynamicTitle: true,
  },
};

export function getAthenaDesignTokenStyle(globals: {
  radius?: unknown;
}): AthenaDesignTokenStyle {
  const radius =
    typeof globals.radius === "string" && radiusTokenMap.has(globals.radius as RadiusTokenName)
      ? radiusTokenMap.get(globals.radius as RadiusTokenName)
      : radiusTokenMap.get("generous");

  return {
    "--radius": radius,
  };
}

export const withAthenaTheme: Decorator = (Story, context) => {
  const theme = context.globals.theme === "dark" ? "dark" : "light";
  const tokenStyle = getAthenaDesignTokenStyle(context.globals);

  return (
    <div className={theme === "dark" ? "dark" : undefined} style={tokenStyle}>
      <div className="min-h-screen bg-background text-foreground">
        <Story />
      </div>
    </div>
  );
};
