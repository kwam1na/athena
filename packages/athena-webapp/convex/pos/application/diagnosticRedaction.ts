/**
 * Shared redaction for free-form diagnostic text that terminals report to the
 * cloud (runtime-status failure messages, client telemetry errors/stacks).
 * Any string a terminal captured from an arbitrary error can carry secrets,
 * tokens, or customer PII — scrub before persisting.
 */

export const REDACTED_DIAGNOSTIC_VALUE = "[redacted]";

export const SENSITIVE_DIAGNOSTIC_PATTERNS = [
  /\bauthorization\s*:\s*[^,;]+/gi,
  /\b(?:authorization\s*:\s*)?bearer\s+[^,\s;]+/gi,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  /(?:\+?\d[\d\s().-]{7,}\d)/g,
  /\b(?:staffProofToken|proofToken|syncSecret|syncSecretHash|token|secret|password|authorization|bearer|cookie|session)[\w-]*\s*[:=]\s*[^,\s;]+/gi,
  /\b(?:sk|pk|ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{12,}\b/g,
];

export function redactSensitiveDiagnosticText(value: string): string {
  return SENSITIVE_DIAGNOSTIC_PATTERNS.reduce(
    (message, pattern) => message.replace(pattern, REDACTED_DIAGNOSTIC_VALUE),
    value,
  );
}
