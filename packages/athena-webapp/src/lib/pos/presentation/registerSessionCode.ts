export function formatRegisterSessionCode(sessionId?: string | null) {
  const trimmedSessionId = sessionId?.trim();

  if (!trimmedSessionId) {
    return undefined;
  }

  return trimmedSessionId.slice(-6).toUpperCase();
}
