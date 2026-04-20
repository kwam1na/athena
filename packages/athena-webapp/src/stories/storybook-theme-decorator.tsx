import type { Decorator, Preview } from "@storybook/react-vite";

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

export const withAthenaTheme: Decorator = (Story, context) => {
  const theme = context.globals.theme === "dark" ? "dark" : "light";

  return (
    <div className={theme === "dark" ? "dark" : undefined}>
      <div className="min-h-screen bg-background text-foreground">
        <Story />
      </div>
    </div>
  );
};
