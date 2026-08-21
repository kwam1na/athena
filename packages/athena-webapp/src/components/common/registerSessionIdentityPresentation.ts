export function formatRegisterHeaderName(registerNumber?: string | null) {
  const registerName = registerNumber?.trim() || "Unnamed register";

  if (/^register\b/i.test(registerName)) {
    return registerName;
  }

  if (registerName === "Unnamed register") {
    return "Register detail";
  }

  return `Register ${registerName}`;
}

export function formatRegisterOperatingDate(operatingDate?: string | null) {
  if (!operatingDate) return null;

  const date = new Date(`${operatingDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return operatingDate;

  return date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    weekday: "short",
    year: "numeric",
  });
}
