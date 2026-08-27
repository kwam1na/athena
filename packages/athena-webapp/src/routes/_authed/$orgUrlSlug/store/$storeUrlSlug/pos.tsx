import { Outlet, createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { DefaultCatchBoundary } from "@/components/auth/DefaultCatchBoundary";
import { PosClientTelemetryHost } from "@/components/pos/PosClientTelemetryHost";
import { isExpectedPosTelemetryOutcome } from "@/lib/pos/application/expectedTelemetryOutcome";
import {
  claimPosTelemetryFailure,
  isPosBrowserCaptureEnabledForCurrentLocation,
  setPosBrowserCaptureFixtureState,
  type PosBrowserCaptureFixtureState,
} from "@/lib/pos/infrastructure/telemetry/browserErrorCapture";
import { enqueuePosClientEvent } from "@/lib/pos/infrastructure/telemetry/telemetryBuffer";
import { usePosHubFixture } from "@/stories/operations/devFixtureActivation";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { z } from "zod";

const posSearchSchema = z.object({
  // Development-only screenshot fixture; inert in production builds.
  fixture: z.string().optional(),
});

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/pos",
)({
  component: PosLayout,
  errorComponent: PosRouteErrorBoundary,
  validateSearch: posSearchSchema,
});

function PosLayout() {
  const { fixture: fixtureName } = Route.useSearch();
  const { fixture, isResolving } = usePosHubFixture(fixtureName);
  const captureState: PosBrowserCaptureFixtureState = isResolving
    ? "resolving"
    : fixture
      ? "authored"
      : "live";

  // Browser capture evaluates fixture state synchronously for failures raised
  // before effects can run. This setter is idempotent and does not touch React
  // or POS state.
  setPosBrowserCaptureFixtureState(captureState);

  if (captureState !== "live") {
    return <Outlet />;
  }

  return (
    <>
      <PosClientTelemetryHost />
      <Outlet />
    </>
  );
}

function PosRouteErrorBoundary(props: ErrorComponentProps) {
  const lastReportedErrorRef = useRef<unknown>();

  useEffect(() => {
    if (
      lastReportedErrorRef.current === props.error ||
      !isPosBrowserCaptureEnabledForCurrentLocation() ||
      isExpectedPosTelemetryOutcome(props.error) ||
      !claimPosTelemetryFailure(props.error)
    ) {
      return;
    }
    lastReportedErrorRef.current = props.error;
    enqueuePosClientEvent({
      classification: "route_render_error",
      error: props.error,
      flow: "runtime",
      operation: "route_render",
      pathname: window.location.pathname,
      level: "error",
    });
  }, [props.error]);

  return <DefaultCatchBoundary {...props} />;
}
