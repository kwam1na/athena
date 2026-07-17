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
