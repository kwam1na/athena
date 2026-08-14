export const DIAGRAM_PROFILES = ["athena", "kwamina-fyi"] as const;
export const DIAGRAM_THEMES = ["light", "dark"] as const;

export type DiagramProfile = (typeof DIAGRAM_PROFILES)[number];
export type DiagramTheme = (typeof DIAGRAM_THEMES)[number];

export type DiagramDefinition = {
  id: string;
  source: string;
  index: number;
  legacyOutput: string;
};

export const DIAGRAMS: readonly DiagramDefinition[] = [
  {
    id: "harness-overview",
    source: "athena-harness-architecture.html",
    index: 0,
    legacyOutput: "harness-overview.png",
  },
  {
    id: "pos-cloud-sync-overview",
    source: "athena-pos-cloud-sync-architecture.html",
    index: 0,
    legacyOutput: "pos-cloud-sync-overview.png",
  },
  {
    id: "pos-local-mechanics",
    source: "athena-pos-cloud-sync-architecture.html",
    index: 1,
    legacyOutput: "pos-local-mechanics.png",
  },
] as const;

export type ExportOptions = {
  profile: DiagramProfile;
  themes: readonly DiagramTheme[];
  bundleDirectory?: string;
};

const readValue = (args: readonly string[], index: number, flag: string) => {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
};

export const parseExportOptions = (args: readonly string[]): ExportOptions => {
  let profile: DiagramProfile = "athena";
  let requestedTheme: DiagramTheme | "all" | undefined;
  let bundleDirectory: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--profile") {
      const value = readValue(args, index, flag);
      if (!DIAGRAM_PROFILES.includes(value as DiagramProfile)) {
        throw new Error(`Unknown diagram profile: ${value}`);
      }
      profile = value as DiagramProfile;
      index += 1;
    } else if (flag === "--theme") {
      const value = readValue(args, index, flag);
      if (value !== "all" && !DIAGRAM_THEMES.includes(value as DiagramTheme)) {
        throw new Error(`Unknown diagram theme: ${value}`);
      }
      requestedTheme = value as DiagramTheme | "all";
      index += 1;
    } else if (flag === "--bundle") {
      bundleDirectory = readValue(args, index, flag);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${flag}`);
    }
  }

  const themes = requestedTheme === "all"
    ? DIAGRAM_THEMES
    : requestedTheme
      ? [requestedTheme]
      : bundleDirectory
        ? DIAGRAM_THEMES
        : ["light" as const];

  return { profile, themes, bundleDirectory };
};

export const bundleFileName = (
  diagram: DiagramDefinition,
  theme: DiagramTheme,
) => `${diagram.id}-${theme}.png`;
