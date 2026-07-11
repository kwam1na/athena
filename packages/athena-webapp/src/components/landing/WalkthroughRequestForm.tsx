import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  type WalkthroughRequestPayload,
  type WalkthroughRequestInput,
  type WalkthroughRequestResult,
  WalkthroughSubmissionIdentity,
  normalizeWalkthroughEmail,
  normalizeWalkthroughText,
  submitWalkthroughRequest,
} from "@/lib/marketing/walkthroughRequestClient";
import { WALKTHROUGH_SUBMISSION_ENABLED } from "@/lib/marketing/walkthroughPrivacy";

type FieldName = keyof WalkthroughRequestPayload;
type FormValues = Required<WalkthroughRequestPayload> & { website: string };
type FormErrors = Partial<Record<FieldName, string>>;

const EMPTY_VALUES: FormValues = {
  name: "",
  workEmail: "",
  businessName: "",
  phone: "",
  businessNeed: "",
  website: "",
};

const FIELD_ORDER: FieldName[] = [
  "name",
  "workEmail",
  "businessName",
  "phone",
  "businessNeed",
];

const RECOVERY_COPY =
  "Request not sent. Your details are still here. Check your connection and try again.";
const CONFLICT_COPY =
  "Request not sent. Your details are still here. Try again to send a new request.";
const VALIDATION_COPY =
  "Request not sent. Review the details above, make any needed changes, and try again.";

export function WalkthroughRequestForm({
  submitRequest = submitWalkthroughRequest,
  submissionEnabled = WALKTHROUGH_SUBMISSION_ENABLED,
}: {
  submitRequest?: (
    input: WalkthroughRequestInput,
  ) => Promise<WalkthroughRequestResult>;
  submissionEnabled?: boolean;
}) {
  const [values, setValues] = useState(EMPTY_VALUES);
  const [errors, setErrors] = useState<FormErrors>({});
  const [status, setStatus] = useState<"idle" | "pending" | "accepted">("idle");
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const fieldRefs = useRef<Partial<Record<FieldName, HTMLElement>>>({});
  const submissionInFlightRef = useRef(false);
  const confirmationHeadingRef = useRef<HTMLHeadingElement>(null);
  const identityRef = useRef<WalkthroughSubmissionIdentity | null>(null);
  if (!identityRef.current) {
    identityRef.current = new WalkthroughSubmissionIdentity();
  }

  useEffect(() => {
    if (status === "accepted") {
      confirmationHeadingRef.current?.focus();
    }
  }, [status]);

  if (status === "accepted") {
    return <WalkthroughConfirmation headingRef={confirmationHeadingRef} />;
  }

  const isPending = status === "pending";

  function updateValue(field: keyof FormValues, value: string) {
    const next = { ...values, [field]: value };
    setValues(next);
    setSubmissionError(null);
    if (field !== "website") {
      setErrors((current) => ({ ...current, [field]: undefined }));
      identityRef.current!.notePayloadChange(next);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!submissionEnabled || isPending || submissionInFlightRef.current) return;

    const nextErrors = validateValues(values);
    setErrors(nextErrors);
    setSubmissionError(null);
    const firstInvalidField = FIELD_ORDER.find((field) => nextErrors[field]);
    if (firstInvalidField) {
      fieldRefs.current[firstInvalidField]?.focus();
      return;
    }

    const payload = toPayload(values);
    const submissionKey = identityRef.current!.beginAttempt(payload);
    submissionInFlightRef.current = true;
    setStatus("pending");

    let result: WalkthroughRequestResult;
    try {
      result = await submitRequest({
        ...payload,
        submissionKey,
        website: values.website,
      });
    } catch {
      result = { kind: "temporarily_unavailable" };
    }
    if (result.kind === "accepted") {
      setStatus("accepted");
      return;
    }

    if (result.kind === "retry_required") {
      identityRef.current!.rotateForRetry(payload);
      setSubmissionError(CONFLICT_COPY);
    } else if (result.kind === "request_rejected") {
      setSubmissionError(VALIDATION_COPY);
    } else {
      setSubmissionError(RECOVERY_COPY);
    }
    submissionInFlightRef.current = false;
    setStatus("idle");
  }

  return (
    <form
      aria-label="Walkthrough request"
      className="space-y-layout-xl"
      noValidate
      onSubmit={handleSubmit}
    >
      <div className="grid gap-layout-lg sm:grid-cols-2">
        <FormField
          id="walkthrough-name"
          label="Name"
          description="The person we should contact."
          error={errors.name}
        >
          <Input
            ref={(node) => { fieldRefs.current.name = node ?? undefined; }}
            id="walkthrough-name"
            name="name"
            autoComplete="name"
            required
            maxLength={100}
            disabled={isPending}
            value={values.name}
            onChange={(event) => updateValue("name", event.target.value)}
            aria-describedby={descriptionIds("walkthrough-name", errors.name)}
            aria-invalid={Boolean(errors.name)}
            className="h-control-standard"
          />
        </FormField>

        <FormField
          id="walkthrough-email"
          label="Work email"
          description="We will use this address to follow up about your request."
          error={errors.workEmail}
        >
          <Input
            ref={(node) => { fieldRefs.current.workEmail = node ?? undefined; }}
            id="walkthrough-email"
            name="workEmail"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            maxLength={254}
            disabled={isPending}
            value={values.workEmail}
            onChange={(event) => updateValue("workEmail", event.target.value)}
            aria-describedby={descriptionIds("walkthrough-email", errors.workEmail)}
            aria-invalid={Boolean(errors.workEmail)}
            className="h-control-standard"
          />
        </FormField>

        <FormField
          id="walkthrough-business"
          label="Business name"
          description="The business you would like to discuss."
          error={errors.businessName}
        >
          <Input
            ref={(node) => { fieldRefs.current.businessName = node ?? undefined; }}
            id="walkthrough-business"
            name="businessName"
            autoComplete="organization"
            required
            maxLength={160}
            disabled={isPending}
            value={values.businessName}
            onChange={(event) => updateValue("businessName", event.target.value)}
            aria-describedby={descriptionIds("walkthrough-business", errors.businessName)}
            aria-invalid={Boolean(errors.businessName)}
            className="h-control-standard"
          />
        </FormField>

        <FormField
          id="walkthrough-phone"
          label="Phone (optional)"
          description="Include a number only if phone is the better way to reach you."
          error={errors.phone}
        >
          <Input
            ref={(node) => { fieldRefs.current.phone = node ?? undefined; }}
            id="walkthrough-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={40}
            disabled={isPending}
            value={values.phone}
            onChange={(event) => updateValue("phone", event.target.value)}
            aria-describedby={descriptionIds("walkthrough-phone", errors.phone)}
            aria-invalid={Boolean(errors.phone)}
            className="h-control-standard"
          />
        </FormField>
      </div>

      <FormField
        id="walkthrough-need"
        label="What would you like more visibility into?"
        description="For example, today's sales, product movement, or stock decisions."
        error={errors.businessNeed}
      >
        <Textarea
          ref={(node) => { fieldRefs.current.businessNeed = node ?? undefined; }}
          id="walkthrough-need"
          name="businessNeed"
          required
          maxLength={1500}
          disabled={isPending}
          value={values.businessNeed}
          onChange={(event) => updateValue("businessNeed", event.target.value)}
          aria-describedby={descriptionIds("walkthrough-need", errors.businessNeed)}
          aria-invalid={Boolean(errors.businessNeed)}
          size="lg"
        />
      </FormField>

      <div className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
        <label htmlFor="walkthrough-website">Website</label>
        <input
          id="walkthrough-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          disabled={isPending}
          value={values.website}
          onChange={(event) => updateValue("website", event.target.value)}
        />
      </div>

      <div className="border-t border-border/70 pt-layout-lg">
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          Athena uses these details to review and follow up on your request. Open
          requests are retained for up to 180 days. Read the{" "}
          <Link className="text-foreground underline underline-offset-4" to="/privacy">
            privacy and retention details
          </Link>
          .
        </p>

        <div
          className={`mt-layout-md min-h-6 text-sm ${submissionError ? "text-destructive" : "text-muted-foreground"}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {submissionError ??
            (!submissionEnabled
              ? "Walkthrough requests will open after the privacy contact is approved."
              : null)}
        </div>

        <Button
          type="submit"
          disabled={isPending || !submissionEnabled}
          aria-busy={isPending}
          className="mt-layout-sm min-h-11 bg-signal text-signal-foreground hover:bg-signal/90"
        >
          {isPending ? "Sending request…" : "Request a walkthrough"}
        </Button>
      </div>
    </form>
  );
}

function FormField({
  id,
  label,
  description,
  error,
  children,
}: {
  id: string;
  label: string;
  description: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-layout-xs">
      <label className="block text-sm font-medium text-foreground" htmlFor={id}>
        {label}
      </label>
      <p id={`${id}-description`} className="text-sm text-muted-foreground">
        {description}
      </p>
      {children}
      <p id={`${id}-error`} className="min-h-5 text-sm text-destructive">
        {error}
      </p>
    </div>
  );
}

function WalkthroughConfirmation({
  headingRef,
}: {
  headingRef: React.RefObject<HTMLHeadingElement>;
}) {
  return (
    <section aria-labelledby="walkthrough-confirmation" className="space-y-layout-lg">
      <div className="space-y-layout-sm">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Walkthrough request
        </p>
        <h2
          ref={headingRef}
          id="walkthrough-confirmation"
          tabIndex={-1}
          className="font-display text-3xl font-light text-foreground focus-visible:outline-none"
        >
          Request received
        </h2>
        <p className="max-w-xl leading-7 text-muted-foreground">
          The Athena team will review the details and follow up using the contact information you provided.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-layout-sm">
        <Link
          to="/"
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-signal px-layout-md text-sm font-medium text-signal-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Back to Athena overview
        </Link>
        <Link
          to="/login"
          className="inline-flex min-h-11 items-center justify-center rounded-md px-layout-md text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Sign in
        </Link>
      </div>
    </section>
  );
}

function descriptionIds(id: string, error?: string) {
  return `${id}-description${error ? ` ${id}-error` : ""}`;
}

function toPayload(values: FormValues): WalkthroughRequestPayload {
  return {
    name: normalizeWalkthroughText(values.name),
    workEmail: normalizeWalkthroughEmail(values.workEmail),
    businessName: normalizeWalkthroughText(values.businessName),
    phone: normalizeWalkthroughText(values.phone) || undefined,
    businessNeed: normalizeWalkthroughText(values.businessNeed),
  };
}

function validateValues(values: FormValues): FormErrors {
  const errors: FormErrors = {};
  const name = normalizeWalkthroughText(values.name);
  const workEmail = normalizeWalkthroughEmail(values.workEmail);
  const businessName = normalizeWalkthroughText(values.businessName);
  const phone = normalizeWalkthroughText(values.phone);
  const businessNeed = normalizeWalkthroughText(values.businessNeed);

  if (name.length < 2) errors.name = "Enter your name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(workEmail)) {
    errors.workEmail = "Enter a valid work email.";
  }
  if (businessName.length < 2) errors.businessName = "Enter your business name.";
  if (phone && phone.length < 7) errors.phone = "Enter a valid phone number or leave this field blank.";
  if (businessNeed.length < 10) {
    errors.businessNeed = "Tell us a little more about what you want to see.";
  }
  return errors;
}
