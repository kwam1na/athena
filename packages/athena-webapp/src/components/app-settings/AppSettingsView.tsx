import {
  Check,
  LoaderCircle,
  Monitor,
  Moon,
  Palette,
  Sun,
  SunMoon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
  requestAthenaSunCycleMode,
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
  { value: "sun-cycle", label: "Sun cycle", icon: SunMoon },
];

function appearanceLabel(theme: "light" | "dark") {
  return theme === "light" ? "Light" : "Dark";
}

function transitionTimeLabel(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

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
  const {
    mode,
    resolvedTheme,
    darkThemeVariant,
    setDarkThemeVariant,
    sunCycle,
  } = useAthenaTheme();
  const [isRequestingLocation, setIsRequestingLocation] = useState(false);
  const [sunCycleError, setSunCycleError] = useState<string | null>(null);
  const locationRequest = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      locationRequest.current?.abort();
    },
    [],
  );

  const selectThemeMode = async (themeMode: AthenaThemeMode) => {
    setSunCycleError(null);
    if (themeMode !== "sun-cycle") {
      locationRequest.current?.abort();
      locationRequest.current = null;
      setIsRequestingLocation(false);
      setAthenaThemeModeWithTransition(themeMode);
      return;
    }
    if (mode === "sun-cycle" || isRequestingLocation) {
      return;
    }

    const request = new AbortController();
    locationRequest.current = request;
    setIsRequestingLocation(true);
    const result = await requestAthenaSunCycleMode(request.signal);
    if (request.signal.aborted) {
      return;
    }
    locationRequest.current = null;
    setIsRequestingLocation(false);
    if (!result.ok && result.reason !== "cancelled") {
      setSunCycleError(
        result.reason === "permission-denied"
          ? "Location access is off. Allow it in your browser to follow sunrise and sunset."
          : "Location is unavailable. Athena kept your current appearance.",
      );
    }
  };

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
                Choose how Athena looks in this workspace.
              </p>
            </div>

            <div className="space-y-layout-md">
              <div
                aria-label="Theme mode"
                className="grid w-full max-w-xl grid-cols-2 gap-1 rounded-lg border border-border/70 bg-muted/50 p-1 sm:w-fit sm:max-w-none sm:grid-cols-4"
                role="group"
              >
                {themeModes.map((themeMode) => {
                  const isLocating =
                    themeMode.value === "sun-cycle" && isRequestingLocation;
                  const Icon = isLocating ? LoaderCircle : themeMode.icon;
                  const isSelected = mode === themeMode.value;

                  return (
                    <button
                      aria-pressed={isSelected}
                      className={cn(
                        "inline-flex h-9 min-w-0 items-center justify-start gap-2 rounded-md px-3 text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-fast ease-standard active:scale-[0.98] sm:min-w-28 sm:justify-center",
                        isSelected
                          ? "bg-background text-foreground shadow-sm ring-1 ring-border/70"
                          : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                      )}
                      key={themeMode.value}
                      onClick={() => void selectThemeMode(themeMode.value)}
                      type="button"
                    >
                      <Icon
                        aria-hidden="true"
                        className={cn(
                          "h-4 w-4 shrink-0",
                          isLocating &&
                            "animate-spin motion-reduce:animate-none",
                        )}
                      />
                      <span className="truncate">{themeMode.label}</span>
                    </button>
                  );
                })}
              </div>

              <p className="text-sm leading-6 text-muted-foreground">
                Active appearance <span aria-hidden="true">·</span>{" "}
                <span className="font-medium text-foreground">
                  {appearanceLabel(resolvedTheme)}
                </span>
                {mode === "sun-cycle" && sunCycle ? (
                  <>
                    {" "}
                    <span aria-hidden="true">·</span>{" "}
                    {appearanceLabel(sunCycle.nextResolvedTheme)} at{" "}
                    <time
                      dateTime={new Date(
                        sunCycle.nextTransitionAt,
                      ).toISOString()}
                    >
                      {transitionTimeLabel(sunCycle.nextTransitionAt)}
                    </time>
                  </>
                ) : null}
              </p>
              {sunCycleError ? (
                <p
                  className="text-sm leading-6 text-muted-foreground"
                  role="status"
                >
                  {sunCycleError}
                </p>
              ) : null}
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
