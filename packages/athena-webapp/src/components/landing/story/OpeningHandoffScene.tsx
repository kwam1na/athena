import { useCallback } from "react";
import { createTimeline, stagger } from "animejs";
import { ArrowRight, Check } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

import { carryForward, demoStore, drawer, formatDemoMoney } from "./demoDay";
import { WorkspaceFrame } from "./SceneChrome";
import { useSceneAnimation } from "./useSceneAnimation";

// Opening Handoff has no extractable presentational component (its checklist
// lives inside the workspace monolith), so this scene composes the product's
// UI primitives (Badge, Separator) around the workspace's own language.
const openingItems = [
  { key: "float", label: `Cash float confirmed — ${formatDemoMoney(drawer.openingFloat)}` },
  { key: "register", label: `Register ${demoStore.registerNumber} online` },
  {
    carried: true,
    key: "carry",
    label: `${carryForward.itemName} running low — carried from last close`,
  },
];

export function OpeningHandoffScene() {
  const rootRef = useSceneAnimation(
    useCallback((root: HTMLElement) => {
      const timeline = createTimeline({
        defaults: { duration: 420, ease: "outQuad" },
      });
      timeline.add(root.querySelectorAll("[data-open-item]"), {
        delay: stagger(240),
        opacity: { from: 0 },
        translateX: { from: -14 },
      });
      timeline.add(
        root.querySelectorAll("[data-open-check]"),
        { delay: stagger(240), ease: "outBack", scale: { from: 0 } },
        "<<+=120",
      );
      timeline.add(root.querySelectorAll("[data-open-status]"), {
        ease: "outBack",
        opacity: { from: 0 },
        scale: { from: 0.8 },
      });
      timeline.add(root.querySelectorAll("[data-open-footer]"), {
        opacity: { from: 0 },
        translateY: { from: 8 },
      });
    }, []),
  );

  return (
    <div ref={rootRef}>
      <WorkspaceFrame
        ariaLabel="The Opening Handoff workspace completing its start-of-day checklist."
        eyebrow="Store Ops"
        title="Opening Handoff"
        meta={
          <span data-open-status>
            <Badge className="border-transparent bg-success/10 font-medium text-success" variant="outline">
              Ready to run
            </Badge>
          </span>
        }
      >
        <ul>
          {openingItems.map((item, index) => (
            <li key={item.key}>
              {index > 0 ? <Separator className="my-layout-sm" /> : null}
              <div data-open-item className="flex items-center gap-layout-sm text-sm">
                <span
                  data-open-check
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success/10 text-success"
                >
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <span className="text-foreground">{item.label}</span>
                {item.carried ? (
                  <Badge
                    className="ml-auto hidden whitespace-nowrap border-transparent bg-signal/10 font-medium text-signal sm:inline-flex"
                    variant="outline"
                  >
                    Carried forward
                  </Badge>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        <p
          data-open-footer
          className="mt-layout-md flex items-center gap-layout-sm border-t border-border pt-layout-md text-sm text-muted-foreground"
        >
          <ArrowRight className="h-4 w-4 text-success" aria-hidden="true" />
          Opening Handoff is complete. The store day is ready to run.
        </p>
      </WorkspaceFrame>
    </div>
  );
}
