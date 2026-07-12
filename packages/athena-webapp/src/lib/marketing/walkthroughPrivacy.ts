const configuredContact = (
  import.meta.env.VITE_WALKTHROUGH_PRIVACY_CONTACT ?? ""
).trim();

export const WALKTHROUGH_PRIVACY_CONTACT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
  configuredContact,
)
  ? configuredContact
  : null;

export const WALKTHROUGH_PRIVACY_NOTICE_STATUS =
  WALKTHROUGH_PRIVACY_CONTACT === null
    ? ("prelaunch_pending_owner_contact" as const)
    : ("ready" as const);

export const WALKTHROUGH_SUBMISSION_ENABLED =
  WALKTHROUGH_PRIVACY_NOTICE_STATUS === "ready";
