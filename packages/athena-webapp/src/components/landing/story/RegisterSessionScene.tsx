import { useCallback } from "react";
import { createTimeline, stagger } from "animejs";

import { RegisterSessionViewContent } from "@/components/cash-controls/RegisterSessionView";

import { demoStore } from "./demoDay";
import { registerSessionSnapshot } from "./demoDayFixtures";
import { WorkspaceExhibit } from "./SceneChrome";
import { useSceneAnimation } from "./useSceneAnimation";

// Every command on the marketing page is inert — the exhibit is pointer-events
// disabled, so these handlers can never actually run; the stub satisfies the
// component's contract without touching Convex.
const exhibitCommandUnavailable = async () => ({
  kind: "unexpected_error" as const,
  error: {
    title: "Read-only exhibit",
    message: "Commands are disabled on the landing page.",
  },
});

// Register 01's session detail, rendered with the product's real
// RegisterSessionViewContent — the same session the Cash Controls dashboard
// holds in review, opened up to tell the drawer's whole day.
export function RegisterSessionScene() {
  const rootRef = useSceneAnimation(
    useCallback((root: HTMLElement) => {
      createTimeline({
        defaults: { duration: 550, ease: "outQuad" },
      }).add(root.querySelectorAll("[data-register-embed] > div > *"), {
        delay: stagger(160),
        opacity: { from: 0 },
        translateY: { from: 14 },
      });
    }, []),
  );

  return (
    <div
      ref={rootRef}
      aria-label="Register 01's session detail mid-closeout: opened on the GH₵500 float at 9:41 AM, GH₵6,700 through the till, counted GH₵2,395 against GH₵2,400 expected, the GH₵5 shortage in review, and the closeout deposit recorded."
      className="w-full"
    >
      <WorkspaceExhibit>
        <div data-register-embed>
          <RegisterSessionViewContent
            currency={demoStore.currency}
            isLoading={false}
            // Shows the header's back control, as in-product; inert on the page.
            onNavigateBack={() => undefined}
            onAuthenticateStaff={exhibitCommandUnavailable}
            onRecordDeposit={exhibitCommandUnavailable}
            onReviewCloseout={exhibitCommandUnavailable}
            onSubmitCloseout={exhibitCommandUnavailable}
            orgUrlSlug="demo"
            registerSessionSnapshot={registerSessionSnapshot}
            storeUrlSlug="central"
          />
        </div>
      </WorkspaceExhibit>
    </div>
  );
}
