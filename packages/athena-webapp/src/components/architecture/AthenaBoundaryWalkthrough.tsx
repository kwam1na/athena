import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { animate, createTimeline, stagger } from "animejs";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Boxes,
  Braces,
  Cable,
  Cloud,
  DatabaseZap,
  FileClock,
  GitBranch,
  LockKeyhole,
  Play,
  RadioTower,
  RotateCcw,
  Route,
  ScanLine,
  ShieldCheck,
  Store,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type LayerKind = "shell" | "authority" | "local" | "cloud" | "evidence";

type BoundaryLayer = {
  id: string;
  title: string;
  eyebrow: string;
  shortLabel: string;
  kind: LayerKind;
  icon: LucideIcon;
  mapColumn: number;
  mapRow: number;
  owns: string[];
  refuses: string[];
  handoff: string;
  sourceAnchors: string[];
};

const layerKindStyles: Record<
  LayerKind,
  {
    accent: string;
    chip: string;
    path: string;
  }
> = {
  shell: {
    accent: "border-action-workflow-border bg-action-workflow-soft text-action-workflow",
    chip: "bg-action-workflow-soft text-action-workflow",
    path: "stroke-[hsl(var(--action-workflow))]",
  },
  authority: {
    accent: "border-warning/40 bg-warning/10 text-warning-foreground",
    chip: "bg-warning/[0.18] text-warning-foreground",
    path: "stroke-[hsl(var(--warning))]",
  },
  local: {
    accent: "border-success/40 bg-success/10 text-success",
    chip: "bg-success/[0.12] text-success",
    path: "stroke-[hsl(var(--success))]",
  },
  cloud: {
    accent: "border-signal/40 bg-signal/10 text-signal",
    chip: "bg-signal/10 text-signal",
    path: "stroke-[hsl(var(--signal))]",
  },
  evidence: {
    accent: "border-foreground/15 bg-foreground/5 text-foreground",
    chip: "bg-foreground/[0.08] text-foreground",
    path: "stroke-[hsl(var(--foreground))]",
  },
};

const boundaryLayers: BoundaryLayer[] = [
  {
    id: "browser-shell",
    title: "Browser Router And Protected App Shell",
    eyebrow: "Boundary 01",
    shortLabel: "App shell",
    kind: "shell",
    icon: Route,
    mapColumn: 1,
    mapRow: 1,
    owns: [
      "TanStack route composition, the public/login split, and the authenticated workspace shell.",
      "Store-scoped navigation into Operations, Products, Services, Cash Controls, POS, Reviews, and Orders.",
      "Browser-safe error normalization before operators see command failures.",
    ],
    refuses: [
      "It does not become a command authority layer just because a route is visible.",
      "It does not import upward from lower feature modules into shell-only ownership.",
    ],
    handoff:
      "Route intent hands work to feature views, hooks, and Convex command boundaries after auth and store context are known.",
    sourceAnchors: [
      "src/main.tsx",
      "src/routes/_authed.tsx",
      "src/routeTree.gen.ts",
      "src/lib/errors/runCommand.ts",
    ],
  },
  {
    id: "pos-route-continuity",
    title: "POS Route-Scoped App-Session Continuity",
    eyebrow: "Boundary 02",
    shortLabel: "POS route",
    kind: "shell",
    icon: RadioTower,
    mapColumn: 2,
    mapRow: 1,
    owns: [
      "Recoverable POS hub continuity when a provisioned terminal waits for app-session validation.",
      "Support-safe posture such as waiting for network or stale validation, redacted by construction.",
      "Keeping non-POS routes on the normal signed-out redirect path.",
    ],
    refuses: [
      "A recovery assertion is not a reusable app credential.",
      "POS route recovery does not authorize a sale, drawer action, staff action, or manager approval.",
    ],
    handoff:
      "A mounted POS shell still has to pass terminal, staff, drawer, and command checks before sale work proceeds.",
    sourceAnchors: [
      "src/routes/_authed.tsx",
      "src/lib/pos/infrastructure/terminal/usePosTerminalAppSessionRecovery.ts",
      "convex/pos/public/terminalAppSessions.ts",
    ],
  },
  {
    id: "terminal-staff",
    title: "Terminal And Staff Authority",
    eyebrow: "Boundary 03",
    shortLabel: "Identity",
    kind: "authority",
    icon: ShieldCheck,
    mapColumn: 3,
    mapRow: 1,
    owns: [
      "Terminal integrity for the provisioned checkout station and store scope.",
      "Local staff authority snapshots with terminal-scoped verifiers.",
      "Event-scoped sync proof evidence after an offline cashier signs in.",
    ],
    refuses: [
      "Online PIN hashes are not offline verifiers.",
      "Cashier proof is not manager approval and does not clear terminal integrity blocks.",
    ],
    handoff:
      "Verified local staff and terminal context become inputs to local command gateways and later sync acceptance.",
    sourceAnchors: [
      "convex/operations/staffProfiles.ts",
      "convex/operations/staffCredentials.ts",
      "src/components/pos/CashierAuthDialog.tsx",
      "src/lib/pos/infrastructure/local/posLocalStore.ts",
    ],
  },
  {
    id: "drawer-command",
    title: "Drawer Lifecycle And Local Command Invariants",
    eyebrow: "Boundary 04",
    shortLabel: "Command gate",
    kind: "authority",
    icon: LockKeyhole,
    mapColumn: 4,
    mapRow: 1,
    owns: [
      "Register-session open, close, reopen, payment, and cart completion preconditions.",
      "Sale blocker policy that separates hard local blockers from cloud-validation uncertainty.",
      "Drawer authority checks before local sale commands mutate the register timeline.",
    ],
    refuses: [
      "Cloud uncertainty alone should not stop a locally safe field sale.",
      "A locally closed drawer is not reusable until a permitted reopen event is recorded.",
    ],
    handoff:
      "Accepted commands append durable POS events first, then the cashier can continue while upload catches up.",
    sourceAnchors: [
      "src/lib/pos/infrastructure/local/saleBlockerPolicy.ts",
      "src/lib/pos/infrastructure/local/localCommandGateway.ts",
      "src/components/pos/register/POSRegisterView.tsx",
      "src/lib/pos/presentation/register/useRegisterViewModel.ts",
    ],
  },
  {
    id: "local-ledger",
    title: "Local POS Event Ledger",
    eyebrow: "Boundary 05",
    shortLabel: "Event log",
    kind: "local",
    icon: DatabaseZap,
    mapColumn: 2,
    mapRow: 2,
    owns: [
      "IndexedDB-backed terminal seed, catalog snapshot, register state, event log, and local-to-cloud mappings.",
      "Terminal-scoped local receipt numbers and reload-surviving pending sale history.",
      "Strict local sequence for checkout, closeout, correction, and uploadable lifecycle events.",
    ],
    refuses: [
      "It is not product-wide offline infrastructure.",
      "It is not a replacement for Convex as the cloud source of truth after projection.",
    ],
    handoff:
      "The ledger drains through the POS sync boundary in register-session order with idempotent local event ids.",
    sourceAnchors: [
      "src/lib/pos/infrastructure/local/posLocalStore.ts",
      "src/lib/pos/infrastructure/local/registerReadModel.ts",
      "src/lib/pos/infrastructure/local/usePosLocalSyncRuntime.ts",
    ],
  },
  {
    id: "sync-reconciliation",
    title: "Sync Projection And Reconciliation",
    eyebrow: "Boundary 06",
    shortLabel: "Projection",
    kind: "local",
    icon: GitBranch,
    mapColumn: 3,
    mapRow: 2,
    owns: [
      "Accepting each local event once and returning stable outcomes on retry.",
      "Projecting accepted events into sessions, transactions, payments, inventory, cash controls, and traces.",
      "Preserving completed local receipts while routing stock, payment, permission, or validation drift into review.",
    ],
    refuses: [
      "Projection must not silently rewrite customer-facing receipt totals.",
      "Pending sync copy is separate from needs-review conflict copy.",
    ],
    handoff:
      "Projected facts join normal Athena cloud records; drift creates manager-review work instead of hiding local history.",
    sourceAnchors: [
      "convex/pos/application/sync/ingestLocalEvents.ts",
      "convex/pos/application/sync/projectLocalEvents.ts",
      "convex/pos/domain/types.ts",
      "convex/operations/registerSessionTracing.ts",
    ],
  },
  {
    id: "convex-domains",
    title: "Convex Domain Commands And Public HTTP",
    eyebrow: "Boundary 07",
    shortLabel: "Cloud",
    kind: "cloud",
    icon: Cloud,
    mapColumn: 4,
    mapRow: 2,
    owns: [
      "Domain-owned commands for stock ops, service ops, staff credentials, store config, storefront operations, and POS sync.",
      "Hono HTTP routes for core, customer-channel, money-movement, webhook, and health boundaries.",
      "Shared command-result rails for expected operator-facing failures.",
    ],
    refuses: [
      "Browser code should not duplicate Convex command decisions.",
      "Raw thrown server text must not become operator copy.",
    ],
    handoff:
      "Cloud commands persist authoritative records and expose browser-safe results back to routed feature surfaces.",
    sourceAnchors: [
      "convex/http.ts",
      "convex/schema.ts",
      "shared/commandResult.ts",
      "convex/stockOps",
      "convex/serviceOps",
      "convex/storeFront",
    ],
  },
  {
    id: "evidence-surfaces",
    title: "Evidence, Review, And Operational Memory",
    eyebrow: "Boundary 08",
    shortLabel: "Evidence",
    kind: "evidence",
    icon: FileClock,
    mapColumn: 5,
    mapRow: 2,
    owns: [
      "Workflow traces, operational events, review queues, terminal health, daily operations, and support diagnostics.",
      "Actor, quantity, register, terminal, receipt, store-day, and reconciliation context for later review.",
      "Calm operational copy that says what happened and what needs attention.",
    ],
    refuses: [
      "Evidence surfaces should not expose reusable secrets, raw assertions, customer payment details, or backend error dumps.",
      "Review counts must come from real sync review evidence, not merely cloud-validation uncertainty.",
    ],
    handoff:
      "Operators and managers see the durable trail: who did what, where it landed, and what still needs review.",
    sourceAnchors: [
      "convex/workflowTraces",
      "src/components/traces/WorkflowTraceView.tsx",
      "src/components/operations",
      "src/components/pos/terminals",
    ],
  },
];

const systemFamilies = [
  {
    label: "POS",
    icon: ScanLine,
    detail: "Local-first checkout, terminal recovery, cashier proof, drawer lifecycle, sync review.",
  },
  {
    label: "Operations",
    icon: Workflow,
    detail: "Open work, approvals, daily open/close, register sessions, traces, and cash controls.",
  },
  {
    label: "Stock",
    icon: Boxes,
    detail: "Catalog, SKUs, adjustments, procurement, receiving, reservations, and availability.",
  },
  {
    label: "Storefront",
    icon: Store,
    detail: "Orders, payments, returns, rewards, reviews, observability, and customer timelines.",
  },
  {
    label: "Services",
    icon: Braces,
    detail: "Intake, appointments, active cases, deposits, service catalog, and inventory usage.",
  },
];

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (!window.matchMedia) {
      return;
    }

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(media.matches);

    const updatePreference = () => setPrefersReducedMotion(media.matches);
    media.addEventListener("change", updatePreference);
    return () => media.removeEventListener("change", updatePreference);
  }, []);

  return prefersReducedMotion;
}

function getLayerStyle(layer: BoundaryLayer, activeLayer: BoundaryLayer) {
  const activeIndex = boundaryLayers.findIndex((item) => item.id === activeLayer.id);
  const layerIndex = boundaryLayers.findIndex((item) => item.id === layer.id);
  if (layer.id === activeLayer.id) {
    return "border-shell-foreground/70 bg-shell-foreground text-shell shadow-overlay";
  }
  if (layerIndex < activeIndex) {
    return "border-success/40 bg-success/[0.12] text-shell-foreground";
  }
  return "border-shell-foreground/15 bg-shell-foreground/[0.07] text-shell-foreground/70 hover:border-shell-foreground/30 hover:bg-shell-foreground/10";
}

export function AthenaBoundaryWalkthrough() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const activeLayer = boundaryLayers[activeIndex];
  const prefersReducedMotion = usePrefersReducedMotion();

  const activeKindStyles = layerKindStyles[activeLayer.kind];
  const nextLayer = boundaryLayers[(activeIndex + 1) % boundaryLayers.length];
  const previousLayer =
    boundaryLayers[(activeIndex - 1 + boundaryLayers.length) % boundaryLayers.length];

  const progressPercent = useMemo(
    () => ((activeIndex + 1) / boundaryLayers.length) * 100,
    [activeIndex],
  );

  useEffect(() => {
    if (prefersReducedMotion || !rootRef.current) {
      return;
    }

    const scope = rootRef.current;
    const intro = createTimeline({
      defaults: {
        duration: 780,
        ease: "outCubic",
      },
    });

    intro
      .add(scope.querySelectorAll("[data-intro='copy']"), {
        opacity: [0, 1],
        y: [18, 0],
        delay: stagger(70),
      })
      .add(
        scope.querySelectorAll("[data-map-node]"),
        {
          opacity: [0, 1],
          scale: [0.84, 1],
          y: [16, 0],
          delay: stagger(42),
        },
        "-=420",
      )
      .add(
        scope.querySelectorAll("[data-flow-line]"),
        {
          opacity: [0, 0.68],
          strokeDashoffset: [180, 0],
          delay: stagger(38),
        },
        "-=520",
      )
      .add(
        scope.querySelectorAll("[data-layer-card]"),
        {
          opacity: [0, 1],
          x: [-16, 0],
          delay: stagger(32),
        },
        "-=560",
      );

    return () => {
      intro.revert();
    };
  }, [prefersReducedMotion]);

  useEffect(() => {
    if (prefersReducedMotion || !rootRef.current) {
      return;
    }

    const scope = rootRef.current;
    const activeNode = scope.querySelector(`[data-map-node="${activeLayer.id}"]`);
    const activeCard = scope.querySelector(`[data-layer-card="${activeLayer.id}"]`);
    const pulseLine = scope.querySelector(`[data-flow-line="${activeLayer.id}"]`);
    const detailPanel = scope.querySelector("[data-active-detail]");

    const animations = [
      activeNode
        ? animate(activeNode, {
            scale: [0.94, 1.04, 1],
            y: [-2, 0],
            duration: 640,
            ease: "outElastic(1, .72)",
          })
        : null,
      activeCard
        ? animate(activeCard, {
            x: [-8, 0],
            duration: 360,
            ease: "outCubic",
          })
        : null,
      detailPanel
        ? animate(detailPanel, {
            opacity: [0.78, 1],
            y: [12, 0],
            duration: 420,
            ease: "outCubic",
          })
        : null,
      pulseLine
        ? animate(pulseLine, {
            strokeDashoffset: [140, 0],
            opacity: [0.18, 1, 0.72],
            duration: 860,
            ease: "inOutCubic",
          })
        : null,
    ];

    return () => {
      animations.forEach((animation) => {
        animation?.revert();
      });
    };
  }, [activeLayer.id, prefersReducedMotion]);

  useEffect(() => {
    if (!isAutoPlaying) {
      return;
    }

    const timer = window.setInterval(() => {
      setActiveIndex((index) => (index + 1) % boundaryLayers.length);
    }, 3600);

    return () => window.clearInterval(timer);
  }, [isAutoPlaying]);

  return (
    <main
      ref={rootRef}
      className="-m-8 min-h-screen overflow-hidden bg-background text-foreground"
    >
      <section className="relative border-b border-border bg-shell text-shell-foreground">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,hsl(var(--signal)/0.26),transparent_28%),radial-gradient(circle_at_82%_12%,hsl(var(--warning)/0.2),transparent_26%),linear-gradient(135deg,hsl(var(--shell))_0%,hsl(var(--shell))_54%,hsl(var(--action-workflow)/0.36)_100%)]" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-[linear-gradient(0deg,hsl(var(--shell))_0%,transparent_100%)]" />

        <div className="relative mx-auto grid min-h-[96vh] max-w-[1500px] gap-layout-2xl px-layout-lg py-layout-2xl lg:grid-cols-[minmax(320px,0.72fr)_minmax(640px,1.28fr)] lg:px-layout-2xl">
          <div className="flex flex-col justify-between gap-layout-2xl">
            <div className="space-y-layout-lg pt-layout-xl">
              <div data-intro="copy" className="inline-flex items-center gap-layout-xs rounded-full border border-shell-foreground/15 bg-shell-foreground/10 px-layout-sm py-layout-xs text-xs font-semibold uppercase tracking-[0.22em] text-shell-foreground/75">
                <Cable className="h-3.5 w-3.5" />
                Athena systems atlas
              </div>
              <div className="space-y-layout-md">
                <h1
                  data-intro="copy"
                  className="max-w-3xl font-display text-5xl leading-none text-shell-foreground md:text-7xl"
                >
                  Walk the boundaries before changing the system.
                </h1>
                <p
                  data-intro="copy"
                  className="max-w-2xl text-lg leading-8 text-shell-foreground/78"
                >
                  Athena is not one broad app layer. It is a stack of carefully
                  separated shells, authority checks, local-first records, cloud
                  projections, and evidence surfaces.
                </p>
              </div>

              <div data-intro="copy" className="flex flex-wrap gap-layout-sm">
                <Button
                  className="h-control-standard bg-signal text-signal-foreground hover:bg-signal/90"
                  onClick={() => setIsAutoPlaying((value) => !value)}
                >
                  {isAutoPlaying ? (
                    <RotateCcw className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  {isAutoPlaying ? "Looping tour" : "Play tour"}
                </Button>
                <Button
                  variant="workflow-soft"
                  className="h-control-standard"
                  onClick={() => setActiveIndex(4)}
                >
                  Jump to local-first
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div data-intro="copy" className="grid gap-layout-sm sm:grid-cols-2">
              {systemFamilies.map((family) => (
                <div
                  key={family.label}
                  className="rounded-lg border border-shell-foreground/10 bg-shell-foreground/[0.07] p-layout-md"
                >
                  <div className="flex items-center gap-layout-sm">
                    <family.icon className="h-4 w-4 text-signal" />
                    <p className="text-sm font-semibold text-shell-foreground">
                      {family.label}
                    </p>
                  </div>
                    <p className="mt-layout-xs text-sm leading-6 text-shell-foreground/70">
                    {family.detail}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div
            ref={mapRef}
            className="relative min-h-[720px] overflow-hidden rounded-[calc(var(--radius)*1.4)] border border-shell-foreground/15 bg-shell-foreground/[0.06] p-layout-lg shadow-overlay backdrop-blur-sm"
          >
            <div className="absolute inset-0 opacity-55 [background-image:linear-gradient(hsl(var(--shell-foreground)/0.08)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--shell-foreground)/0.08)_1px,transparent_1px)] [background-size:42px_42px]" />
            <div className="absolute left-0 top-16 h-px w-full bg-gradient-to-r from-transparent via-shell-foreground/30 to-transparent" />
            <div className="absolute bottom-10 right-10 h-44 w-44 rounded-full border border-signal/30 bg-signal/10 blur-3xl" />

            <div className="relative z-10 flex h-full flex-col gap-layout-lg">
              <div className="flex flex-col gap-layout-sm border-b border-shell-foreground/12 pb-layout-md md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-shell-foreground/52">
                    Current layer
                  </p>
                  <h2 className="mt-layout-xs text-2xl font-semibold text-shell-foreground">
                    {activeLayer.shortLabel}
                  </h2>
                </div>
                <div className="flex items-center gap-layout-xs">
                  <Button
                    aria-label={`Previous layer: ${previousLayer.shortLabel}`}
                    className="h-10 w-10 border-shell-foreground/18 bg-shell-foreground/8 text-shell-foreground hover:bg-shell-foreground/14"
                    onClick={() =>
                      setActiveIndex(
                        (index) =>
                          (index - 1 + boundaryLayers.length) %
                          boundaryLayers.length,
                      )
                    }
                    size="icon"
                    variant="utility"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    aria-label={`Next layer: ${nextLayer.shortLabel}`}
                    className="h-10 w-10 bg-signal text-signal-foreground hover:bg-signal/90"
                    onClick={() =>
                      setActiveIndex((index) => (index + 1) % boundaryLayers.length)
                    }
                    size="icon"
                  >
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="grid flex-1 gap-layout-lg 2xl:grid-cols-[minmax(640px,1fr)_360px]">
                <div className="relative min-h-[520px] rounded-lg border border-shell-foreground/10 bg-shell/[0.34] p-layout-md">
                  <svg
                    aria-hidden="true"
                    className="absolute inset-0 h-full w-full"
                    preserveAspectRatio="none"
                    viewBox="0 0 1000 620"
                  >
                    {boundaryLayers.slice(0, -1).map((layer, index) => {
                      const next = boundaryLayers[index + 1];
                      const isActive = layer.id === activeLayer.id;
                      return (
                        <path
                          key={layer.id}
                          data-flow-line={layer.id}
                          className={cn(
                            "fill-none stroke-[3px] opacity-45",
                            isActive ? layerKindStyles[layer.kind].path : "stroke-shell-foreground/24",
                          )}
                          d={`M ${layer.mapColumn * 168 - 80} ${layer.mapRow * 188 - 34} C ${
                            layer.mapColumn * 168 + 42
                          } ${layer.mapRow * 188 - 90}, ${
                            next.mapColumn * 168 - 160
                          } ${next.mapRow * 188 + 20}, ${
                            next.mapColumn * 168 - 80
                          } ${next.mapRow * 188 - 34}`}
                          pathLength="180"
                          strokeDasharray={isActive ? "16 10" : "3 10"}
                          strokeLinecap="round"
                        />
                      );
                    })}
                  </svg>

                  <div className="relative z-10 grid h-full grid-cols-2 gap-layout-md md:grid-cols-5">
                    {boundaryLayers.map((layer) => {
                      const isActive = layer.id === activeLayer.id;
                      const hasPassed =
                        boundaryLayers.findIndex((item) => item.id === layer.id) <
                        activeIndex;
                      return (
                        <button
                          key={layer.id}
                          data-map-node={layer.id}
                          className={cn(
                            "group relative flex min-h-[136px] flex-col justify-between rounded-lg border p-layout-md text-left transition duration-standard ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal",
                            "md:[grid-column:var(--map-column)] md:[grid-row:var(--map-row)]",
                            getLayerStyle(layer, activeLayer),
                          )}
                          onClick={() =>
                            setActiveIndex(
                              boundaryLayers.findIndex((item) => item.id === layer.id),
                            )
                          }
                          style={
                            {
                              "--map-column": layer.mapColumn,
                              "--map-row": layer.mapRow,
                            } as CSSProperties
                          }
                        >
                          <span
                            className={cn(
                              "absolute -right-2 -top-2 h-5 w-5 rounded-full border border-shell bg-shell text-[10px] font-semibold text-shell-foreground transition",
                              isActive ? "scale-100 bg-signal text-signal-foreground" : "scale-75 opacity-60",
                              hasPassed ? "bg-success text-success-foreground" : null,
                            )}
                          >
                            {hasPassed ? "✓" : boundaryLayers.indexOf(layer) + 1}
                          </span>
                          <span className="flex items-center justify-between gap-layout-sm">
                            <layer.icon className={cn("h-5 w-5", isActive ? "text-signal" : "text-current")} />
                            <span
                              className={cn(
                                "rounded-full px-layout-xs py-1 text-[10px] font-semibold uppercase tracking-[0.16em]",
                                layerKindStyles[layer.kind].chip,
                              )}
                            >
                              {layer.kind}
                            </span>
                          </span>
                          <span>
                            <span className="block text-xs font-semibold uppercase tracking-[0.18em] opacity-60">
                              {layer.eyebrow}
                            </span>
                            <span className="mt-layout-xs block text-lg font-semibold leading-tight">
                              {layer.shortLabel}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <aside
                  data-active-detail
                  className="rounded-lg border border-shell-foreground/10 bg-shell-foreground/[0.08] p-layout-lg text-shell-foreground"
                >
                  <div className="space-y-layout-lg">
                    <div className="space-y-layout-sm">
                      <div
                        className={cn(
                          "inline-flex items-center gap-layout-xs rounded-full border px-layout-sm py-layout-xs text-xs font-semibold uppercase tracking-[0.2em]",
                          activeKindStyles.accent,
                        )}
                      >
                        <activeLayer.icon className="h-3.5 w-3.5" />
                        {activeLayer.eyebrow}
                      </div>
                      <h3 className="text-3xl font-semibold leading-tight">
                        {activeLayer.title}
                      </h3>
                      <p className="leading-7 text-shell-foreground/72">
                        {activeLayer.handoff}
                      </p>
                    </div>

                    <BoundaryList
                      icon={BadgeCheck}
                      items={activeLayer.owns}
                      title="Owns"
                    />
                    <BoundaryList
                      icon={LockKeyhole}
                      items={activeLayer.refuses}
                      title="Must not grant"
                    />

                    <div className="space-y-layout-sm border-t border-shell-foreground/12 pt-layout-md">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-shell-foreground/50">
                        Code anchors
                      </p>
                      <div className="flex flex-wrap gap-layout-xs">
                        {activeLayer.sourceAnchors.map((anchor) => (
                          <span
                            key={anchor}
                            className="rounded-md border border-shell-foreground/10 bg-shell/[0.36] px-layout-xs py-1 font-mono text-xs text-shell-foreground/75"
                          >
                            {anchor}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </aside>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="px-layout-lg py-layout-3xl md:px-layout-2xl">
        <div className="mx-auto grid max-w-7xl gap-layout-2xl lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-layout-md">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-signal">
              Layer notes
            </p>
            <h2 className="font-display text-4xl leading-none md:text-6xl">
              The same rule shows up everywhere.
            </h2>
            <p className="text-lg leading-8 text-muted-foreground">
              Each boundary should own one decision, pass forward the minimum
              safe evidence, and refuse authority that belongs to a deeper
              layer.
            </p>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-signal transition-all duration-slow ease-emphasized"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          <div className="grid gap-layout-md md:grid-cols-2">
            {boundaryLayers.map((layer, index) => (
              <button
                key={layer.id}
                data-layer-card={layer.id}
                className={cn(
                  "rounded-lg border p-layout-lg text-left transition duration-standard ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal",
                  index === activeIndex
                    ? "border-signal bg-signal/10 shadow-surface"
                    : "border-border bg-surface hover:border-signal/40 hover:bg-surface-raised",
                )}
                onClick={() => setActiveIndex(index)}
              >
                <div className="flex items-start justify-between gap-layout-md">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                      {layer.eyebrow}
                    </p>
                    <h3 className="mt-layout-xs text-xl font-semibold">
                      {layer.shortLabel}
                    </h3>
                  </div>
                  <span
                    className={cn(
                      "rounded-full p-layout-xs",
                      layerKindStyles[layer.kind].chip,
                    )}
                  >
                    <layer.icon className="h-4 w-4" />
                  </span>
                </div>
                <p className="mt-layout-md leading-7 text-muted-foreground">
                  {layer.handoff}
                </p>
              </button>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function BoundaryList({
  icon: Icon,
  items,
  title,
}: {
  icon: LucideIcon;
  items: string[];
  title: string;
}) {
  return (
    <div className="space-y-layout-sm">
      <p className="flex items-center gap-layout-xs text-xs font-semibold uppercase tracking-[0.2em] text-shell-foreground/50">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </p>
      <ul className="space-y-layout-sm">
        {items.map((item) => (
          <li
            key={item}
            className="rounded-md border border-shell-foreground/10 bg-shell/[0.24] p-layout-sm text-sm leading-6 text-shell-foreground/80"
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
