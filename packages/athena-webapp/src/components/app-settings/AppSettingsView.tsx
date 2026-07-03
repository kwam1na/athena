import { Check, Monitor, Moon, Palette, Sun } from "lucide-react";

import {
  PageLevelHeader,
  PageWorkspace,
} from "@/components/common/PageLevelHeader";
import { FadeIn } from "@/components/common/FadeIn";
import View from "@/components/View";
import { cn } from "@/lib/utils";
import {
  type AthenaDarkThemeVariant,
  type AthenaThemeMode,
  setAthenaThemeModeWithTransition,
  useAthenaTheme,
} from "@/lib/theme";

const themeModes: Array<{
  value: AthenaThemeMode;
  label: string;
  icon: typeof Monitor;
}> = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

const darkThemeVariants: Array<{
  value: AthenaDarkThemeVariant;
  label: string;
  swatches: string[];
}> = [
  {
    value: "charcoal",
    label: "Charcoal",
    swatches: ["bg-[#161616]", "bg-[#1f1f1f]", "bg-[#e36aa2]"],
  },
  {
    value: "classic",
    label: "Midnight",
    swatches: ["bg-[#11131c]", "bg-[#20242f]", "bg-[#e779ad]"],
  },
];

export function AppSettingsView() {
  const { mode, resolvedTheme, darkThemeVariant, setDarkThemeVariant } =
    useAthenaTheme();

  return (
    <View hideBorder hideHeaderBottomBorder scrollMode="page">
      <FadeIn className="container mx-auto py-layout-xl">
        <PageWorkspace>
          <PageLevelHeader
            title="App settings"
            description="Set local workspace preferences for this browser."
          />

          <section className="max-w-3xl space-y-layout-lg">
            <div className="space-y-layout-xs">
              <div className="flex items-center gap-2">
                <Palette
                  aria-hidden="true"
                  className="h-4 w-4 text-muted-foreground"
                />
                <h2 className="text-lg font-semibold text-foreground">Theme</h2>
              </div>
              <p className="text-sm leading-6 text-muted-foreground">
                Choose how Athena should render in this browser.
              </p>
            </div>

            <div className="space-y-layout-md">
              <div
                aria-label="Theme mode"
                className="grid gap-2 rounded-md border border-border bg-surface p-2 sm:grid-cols-3 sm:p-1"
                role="group"
              >
                {themeModes.map((themeMode) => {
                  const Icon = themeMode.icon;
                  const isSelected = mode === themeMode.value;

                  return (
                    <button
                      aria-pressed={isSelected}
                      className={cn(
                        "inline-flex h-11 min-w-0 items-center justify-start gap-2 rounded px-3 text-sm font-medium transition-[background-color,color] duration-fast ease-standard sm:justify-center",
                        isSelected
                          ? "bg-foreground text-background"
                          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                      )}
                      key={themeMode.value}
                      onClick={() =>
                        setAthenaThemeModeWithTransition(themeMode.value)
                      }
                      type="button"
                    >
                      <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                      <span className="truncate">{themeMode.label}</span>
                    </button>
                  );
                })}
              </div>

              <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                Active appearance: {resolvedTheme}
              </p>
            </div>

            {mode === "dark" ? (
              <div className="space-y-layout-sm">
                <h3 className="text-sm font-semibold text-foreground">
                  Dark palette
                </h3>

                <div className="grid gap-layout-sm sm:grid-cols-2">
                  {darkThemeVariants.map((variant) => {
                    const isSelected = darkThemeVariant === variant.value;

                    return (
                      <button
                        aria-pressed={isSelected}
                        className={cn(
                          "rounded-md border bg-surface p-layout-sm text-left transition-[background-color,border-color,color] duration-fast ease-standard hover:bg-surface-muted",
                          isSelected
                            ? "border-foreground"
                            : "border-border text-muted-foreground",
                        )}
                        key={variant.value}
                        onClick={() => setDarkThemeVariant(variant.value)}
                        type="button"
                      >
                        <span className="flex items-center justify-between gap-layout-md">
                          <span className="min-w-0 truncate text-sm font-semibold text-foreground">
                            {variant.label}
                          </span>
                          {isSelected ? (
                            <Check
                              aria-hidden="true"
                              className="h-4 w-4 shrink-0 text-foreground"
                            />
                          ) : null}
                        </span>
                        <span
                          className="mt-layout-sm flex gap-2"
                          aria-hidden="true"
                        >
                          {variant.swatches.map((swatch) => (
                            <span
                              className={cn(
                                "h-6 flex-1 rounded border border-white/10",
                                swatch,
                              )}
                              key={swatch}
                            />
                          ))}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </section>
        </PageWorkspace>
      </FadeIn>
    </View>
  );
}
