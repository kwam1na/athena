export function buildOperationalEventMessage(args: {
  eventType: string;
  subjectType: string;
  subjectLabel?: string;
}) {
  const subject = args.subjectLabel?.trim() || args.subjectType;
  return `${args.eventType} on ${subject}`;
}
