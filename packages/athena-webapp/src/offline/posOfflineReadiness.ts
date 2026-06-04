export type PosOfflineReadinessDomain =
  | "app_shell"
  | "terminal_seed"
  | "staff_authority"
  | "register_catalog"
  | "service_catalog"
  | "availability_snapshot";

export type PosOfflineReadinessSignalStatus =
  | "ready"
  | "needs_attention"
  | "unknown";

export type PosOfflineReadinessSignalInput = {
  ageMs?: number | null;
  label?: string;
  ready?: boolean | null;
  status?: PosOfflineReadinessSignalStatus;
};

export type PosOfflineReadinessInput = {
  appShell?: PosOfflineReadinessSignalInput | null;
  availabilitySnapshot?: PosOfflineReadinessSignalInput | null;
  registerCatalog?: PosOfflineReadinessSignalInput | null;
  serviceCatalog?: PosOfflineReadinessSignalInput | null;
  staffAuthority?: PosOfflineReadinessSignalInput | null;
  terminalSeed?: PosOfflineReadinessSignalInput | null;
};

export type PosOfflineReadinessSignal = {
  description: string;
  domain: PosOfflineReadinessDomain;
  label: string;
  status: PosOfflineReadinessSignalStatus;
};

export type PosOfflineReadinessSummary = {
  description: string;
  readyCount: number;
  signals: PosOfflineReadinessSignal[];
  status: PosOfflineReadinessSignalStatus;
  title: string;
};

type DomainDefinition = {
  domain: PosOfflineReadinessDomain;
  label: string;
  missingDescription: string;
  needsAttentionDescription: string;
  readyDescription: string;
  staleAfterMs?: number;
};

const DAY_MS = 24 * 60 * 60_000;

const DOMAIN_DEFINITIONS: Array<{
  definition: DomainDefinition;
  getInput: (
    input: PosOfflineReadinessInput,
  ) => PosOfflineReadinessSignalInput | null | undefined;
}> = [
  {
    definition: {
      domain: "app_shell",
      label: "App shell",
      missingDescription:
        "App shell status has not reported to this page yet.",
      needsAttentionDescription:
        "App shell recovery needs attention before offline route access is reliable.",
      readyDescription: "App shell recovery is ready.",
    },
    getInput: (input) => input.appShell,
  },
  {
    definition: {
      domain: "terminal_seed",
      label: "Terminal setup",
      missingDescription:
        "Terminal setup has not reported to this page yet.",
      needsAttentionDescription:
        "Terminal setup data is missing on this checkout station.",
      readyDescription: "Terminal setup data is stored locally.",
    },
    getInput: (input) => input.terminalSeed,
  },
  {
    definition: {
      domain: "staff_authority",
      label: "Staff authority",
      missingDescription: "Staff authority has not reported to this page yet.",
      needsAttentionDescription:
        "Local staff authority is missing or expired on this checkout station.",
      readyDescription: "Local staff authority is ready.",
      staleAfterMs: DAY_MS,
    },
    getInput: (input) => input.staffAuthority,
  },
  {
    definition: {
      domain: "register_catalog",
      label: "Register catalog",
      missingDescription: "Register catalog has not reported to this page yet.",
      needsAttentionDescription:
        "Register catalog data needs a fresh local snapshot.",
      readyDescription: "Register catalog data is available locally.",
      staleAfterMs: DAY_MS,
    },
    getInput: (input) => input.registerCatalog,
  },
  {
    definition: {
      domain: "service_catalog",
      label: "Service catalog",
      missingDescription: "Service catalog has not reported to this page yet.",
      needsAttentionDescription:
        "Service catalog data needs a fresh local snapshot.",
      readyDescription: "Service catalog data is available locally.",
      staleAfterMs: DAY_MS,
    },
    getInput: (input) => input.serviceCatalog,
  },
  {
    definition: {
      domain: "availability_snapshot",
      label: "Availability snapshot",
      missingDescription:
        "Availability snapshot has not reported to this page yet.",
      needsAttentionDescription:
        "Availability data needs a fresh local snapshot.",
      readyDescription: "Availability data is available locally.",
      staleAfterMs: DAY_MS,
    },
    getInput: (input) => input.availabilitySnapshot,
  },
];

export function buildPosOfflineReadinessSummary(
  input: PosOfflineReadinessInput,
): PosOfflineReadinessSummary {
  const signals = DOMAIN_DEFINITIONS.map(({ definition, getInput }) =>
    buildSignal(definition, getInput(input)),
  );
  const readyCount = signals.filter((signal) => signal.status === "ready").length;
  const needsAttentionCount = signals.filter(
    (signal) => signal.status === "needs_attention",
  ).length;
  const status =
    needsAttentionCount > 0
      ? "needs_attention"
      : readyCount === signals.length
        ? "ready"
        : "unknown";

  return {
    description: getSummaryDescription(status, readyCount, signals.length),
    readyCount,
    signals,
    status,
    title: getSummaryTitle(status),
  };
}

function buildSignal(
  definition: DomainDefinition,
  input: PosOfflineReadinessSignalInput | null | undefined,
): PosOfflineReadinessSignal {
  if (!input) {
    return {
      description: definition.missingDescription,
      domain: definition.domain,
      label: definition.label,
      status: "unknown",
    };
  }

  const status = getSignalStatus(definition, input);

  return {
    description: input.label ?? getSignalDescription(definition, input, status),
    domain: definition.domain,
    label: definition.label,
    status,
  };
}

function getSignalStatus(
  definition: DomainDefinition,
  input: PosOfflineReadinessSignalInput,
): PosOfflineReadinessSignalStatus {
  if (input.status) return input.status;
  if (input.ready === false) return "needs_attention";
  if (input.ready === true) {
    if (
      definition.staleAfterMs &&
      typeof input.ageMs === "number" &&
      Number.isFinite(input.ageMs) &&
      input.ageMs > definition.staleAfterMs
    ) {
      return "needs_attention";
    }
    return "ready";
  }
  return "unknown";
}

function getSignalDescription(
  definition: DomainDefinition,
  input: PosOfflineReadinessSignalInput,
  status: PosOfflineReadinessSignalStatus,
) {
  if (status === "needs_attention") {
    if (
      definition.staleAfterMs &&
      typeof input.ageMs === "number" &&
      input.ageMs > definition.staleAfterMs
    ) {
      return `${definition.label} is ${formatAge(input.ageMs)} old.`;
    }
    return definition.needsAttentionDescription;
  }

  if (status === "ready") {
    if (typeof input.ageMs === "number" && Number.isFinite(input.ageMs)) {
      return `${definition.readyDescription} Last refreshed ${formatAge(
        input.ageMs,
      )} ago.`;
    }
    return definition.readyDescription;
  }

  return definition.missingDescription;
}

function getSummaryTitle(status: PosOfflineReadinessSignalStatus) {
  if (status === "ready") return "Register ready for offline checkout";
  if (status === "needs_attention") return "Offline diagnostics need attention";
  return "Offline diagnostics partially reported";
}

function getSummaryDescription(
  status: PosOfflineReadinessSignalStatus,
  readyCount: number,
  totalCount: number,
) {
  if (status === "ready") {
    return "This checkout station has the app shell, terminal setup, staff authority, catalog, and availability data needed for offline POS.";
  }

  if (status === "needs_attention") {
    return "One or more offline diagnostic signals need attention. This view is diagnostic only.";
  }

  return `${readyCount} of ${totalCount} offline diagnostic signals are reporting here. Missing signals do not block checkout by themselves.`;
}

function formatAge(ageMs: number) {
  const minutes = Math.max(1, Math.round(ageMs / 60_000));
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}
