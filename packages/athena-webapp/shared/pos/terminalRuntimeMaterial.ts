type RuntimeSection = Record<string, unknown> | null | undefined;

export type TerminalRuntimeMaterialInput = {
  activeRegisterSession?: RuntimeSection;
  appSessionRecovery?: RuntimeSection;
  appUpdate?: RuntimeSection;
  drawerAuthority?: RuntimeSection;
  localStore?: RuntimeSection;
  saleAuthority?: RuntimeSection;
  staffAuthority?: RuntimeSection;
  sync?: RuntimeSection;
  terminalIntegrity?: RuntimeSection;
};

export function projectTerminalRuntimeMaterial(
  status: TerminalRuntimeMaterialInput,
) {
  return stripUndefined({
    activeRegisterSession: projectActiveRegisterSession(
      status.activeRegisterSession,
    ),
    appSessionRecovery: projectStatus(status.appSessionRecovery),
    appUpdate: projectAppUpdate(status.appUpdate),
    drawerAuthority: projectDrawerAuthority(status.drawerAuthority),
    localStore: projectLocalStore(status.localStore),
    saleAuthority: projectStatus(status.saleAuthority),
    staffAuthority: projectStaffAuthority(status.staffAuthority),
    sync: projectSync(status.sync),
    terminalIntegrity: projectStatus(status.terminalIntegrity),
  });
}

export function getTerminalRuntimeMaterialSignature(
  status: TerminalRuntimeMaterialInput,
) {
  return JSON.stringify(projectTerminalRuntimeMaterial(status));
}

function projectActiveRegisterSession(value: RuntimeSection) {
  if (!value) return undefined;
  return stripUndefined({
    cloudRegisterSessionId: value.cloudRegisterSessionId,
    localRegisterSessionId: value.localRegisterSessionId,
    openedAt: value.openedAt,
    registerNumber: value.registerNumber,
    status: value.status,
  });
}

function projectAppUpdate(value: RuntimeSection) {
  if (!value) return undefined;
  return stripUndefined({
    commandExecutionId: value.commandExecutionId,
    status: value.status,
  });
}

function projectDrawerAuthority(value: RuntimeSection) {
  if (!value) return undefined;
  return stripUndefined({
    cloudRegisterSessionId: value.cloudRegisterSessionId,
    localRegisterSessionId: value.localRegisterSessionId,
    status: value.status,
  });
}

function projectLocalStore(value: RuntimeSection) {
  if (!value) return undefined;
  return stripUndefined({
    available: value.available,
    terminalSeedReady: value.terminalSeedReady,
  });
}

function projectStatus(value: RuntimeSection) {
  if (!value) return undefined;
  return stripUndefined({ status: value.status });
}

function projectStaffAuthority(value: RuntimeSection) {
  if (!value) return undefined;
  return stripUndefined({
    staffProfileId: value.staffProfileId,
    status: value.status,
  });
}

function projectSync(value: RuntimeSection) {
  if (!value) return undefined;
  const reviewEventCount =
    typeof value.reviewEventCount === "number" ? value.reviewEventCount : 0;
  return stripUndefined({
    reviewEventCount,
    reviewEvents: reviewEventCount > 0 ? value.reviewEvents : undefined,
    status: value.status,
  });
}

function stripUndefined<T extends Record<string, unknown>>(input: T) {
  return Object.fromEntries(
    Object.entries(input).filter((entry) => entry[1] !== undefined),
  );
}
