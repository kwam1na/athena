import { useQuery } from "convex/react";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowUpRight, Circle } from "lucide-react";
import type { Id } from "~/convex/_generated/dataModel";

import View from "../View";
import { ComposedPageHeader } from "../common/PageHeader";
import { FadeIn } from "../common/FadeIn";
import {
  RegisterSessionIdentity,
  type RegisterSessionIdentityModel,
} from "../common/RegisterSessionIdentity";
import { NotFoundView } from "../states/not-found/NotFoundView";
import { RelativeTimestamp } from "../ui/relative-timestamp";
import { api } from "~/convex/_generated/api";
import { capitalizeWords } from "~/src/lib/utils";
import { currencyFormatter } from "~/src/lib/utils";
import { useGetTerminal } from "@/hooks/useGetTerminal";
import { getOrigin } from "~/src/lib/navigationUtils";
import { MAX_WORKFLOW_TRACE_EVENTS } from "~/shared/operationalEvidenceLimits";

export type WorkflowTraceHeaderModel = {
  health: string;
  primaryLookupType: string;
  primaryLookupValue: string;
  registerSession?: RegisterSessionIdentityModel | null;
  status: string;
  summary?: string;
  title: string;
  traceId: string;
  workflowType: string;
};

export type WorkflowTraceEventModel = {
  actorRefs?: Record<string, string>;
  details?: Record<string, unknown>;
  kind: string;
  message?: string | null;
  occurredAt: number;
  sequence: number;
  source: string;
  subjectRefs?: Record<string, string>;
  status: string;
  step: string;
  traceId: string;
  workflowType: string;
};

export type WorkflowTraceViewModel = {
  currency?: string;
  eventLimit?: number;
  events: WorkflowTraceEventModel[];
  eventsTruncated?: boolean;
  header: WorkflowTraceHeaderModel;
};

function formatTraceMoney(value: unknown, currency: string) {
  return typeof value === "number"
    ? currencyFormatter(currency).format(value / 100)
    : null;
}

function getLifecycleStatement(
  event: WorkflowTraceEventModel,
  currency: string,
) {
  const details = event.details ?? {};
  if (event.step === "register_session_opened") {
    const staffName =
      typeof details.openedBy === "string"
        ? details.openedBy
        : "A staff member";
    const register =
      typeof details.registerNumber === "string"
        ? `Register ${details.registerNumber}`
        : "the register";
    const terminal =
      typeof details.terminal === "string" ? ` on ${details.terminal}` : "";
    const openingFloat = formatTraceMoney(details.openingFloat, currency);
    const floatStatement =
      details.openingFloat === 0
        ? " with no opening float"
        : openingFloat
          ? ` with an opening float of ${openingFloat}`
          : "";
    return `${staffName} opened ${register}${terminal}${floatStatement}.`;
  }
  if (event.step === "register_session_closeout_submitted") {
    const staffName =
      typeof details.actorName === "string"
        ? details.actorName
        : "A staff member";
    const register =
      typeof details.registerNumber === "string"
        ? `Register ${details.registerNumber}`
        : "the register";
    const expected = formatTraceMoney(details.expectedCash, currency);
    const counted = formatTraceMoney(details.countedCash, currency);
    const varianceValue =
      typeof details.variance === "number" ? details.variance : null;
    if (expected && counted && varianceValue !== null) {
      if (varianceValue === 0) {
        return `${staffName} submitted the closeout for ${register} with an exact cash match of ${counted}.`;
      }
      const variance = formatTraceMoney(Math.abs(varianceValue), currency);
      return `${staffName} submitted the closeout for ${register} with ${counted} counted against ${expected} expected, a ${variance} ${varianceValue > 0 ? "overage" : "shortfall"}.`;
    }
    return `${staffName} submitted the closeout for ${register}.`;
  }
  if (
    event.step === "register_session_closed" ||
    event.step === "register_session_closeout_approved"
  ) {
    const staffName =
      typeof details.closedBy === "string"
        ? details.closedBy
        : "A staff member";
    const register =
      typeof details.registerNumber === "string"
        ? `Register ${details.registerNumber}`
        : "the register";
    const expected = formatTraceMoney(details.expectedCash, currency);
    const counted = formatTraceMoney(details.countedCash, currency);
    const varianceValue =
      typeof details.variance === "number" ? details.variance : null;
    if (expected && counted && varianceValue !== null) {
      if (varianceValue === 0) {
        return `${staffName} closed ${register} with an exact cash match of ${counted}.`;
      }
      const variance = formatTraceMoney(Math.abs(varianceValue), currency);
      return `${staffName} closed ${register} with ${counted} counted against ${expected} expected, a ${variance} ${varianceValue > 0 ? "overage" : "shortfall"}.`;
    }
    return `${staffName} closed ${register}.`;
  }
  return "";
}

function formatPaymentMethods(value: unknown) {
  if (!Array.isArray(value)) return "";
  const methods = value.map((method) =>
    formatTraceLabel(String(method)).toLocaleLowerCase(),
  );
  if (methods.length < 2) return methods[0] ?? "";
  return `${methods.slice(0, -1).join(", ")} and ${methods.at(-1)}`;
}

function getTransactionStatement(
  event: WorkflowTraceEventModel,
  currency: string,
) {
  const details = event.details ?? {};
  const actorName =
    typeof details.actorName === "string"
      ? details.actorName
      : "A staff member";
  const transaction =
    typeof details.transactionNumber === "string"
      ? `transaction #${details.transactionNumber}`
      : "a transaction";
  const cashDelta =
    typeof details.cashDelta === "number" ? details.cashDelta : null;

  if (event.step === "register_session_sale_recorded") {
    const saleTotal = formatTraceMoney(
      details.saleTotal ?? details.amount,
      currency,
    );
    if (!saleTotal) return "";
    const tender = formatPaymentMethods(details.paymentMethodLabels);
    const saleDescription = tender ? `${tender} sale` : "sale";
    if (cashDelta === 0) {
      return `${actorName} recorded ${transaction}, a ${saleTotal} ${saleDescription}. No drawer impact.`;
    }
    const drawerAmount = formatTraceMoney(Math.abs(cashDelta ?? 0), currency);
    return drawerAmount
      ? `${actorName} recorded ${transaction}, a ${saleTotal} ${saleDescription}. Drawer ${cashDelta && cashDelta < 0 ? "−" : "+"}${drawerAmount}.`
      : `${actorName} recorded ${transaction}, a ${saleTotal} ${saleDescription}.`;
  }

  if (event.step === "register_session_void_recorded") {
    const amount = formatTraceMoney(
      details.saleTotal ?? details.amount,
      currency,
    );
    if (!amount) return "";
    const approval =
      typeof details.approvedByName === "string"
        ? ` Approved by ${details.approvedByName}.`
        : "";
    const drawerImpact =
      cashDelta === 0
        ? " No drawer impact."
        : cashDelta !== null
          ? ` Drawer −${formatTraceMoney(Math.abs(cashDelta), currency)}.`
          : "";
    return `${actorName} recorded a ${amount} void for ${transaction}.${approval}${drawerImpact}`;
  }

  return "";
}

function formatTraceLabel(value: string) {
  return capitalizeWords(value.replaceAll("_", " ").replaceAll("-", " "));
}

export function WorkflowTraceHeader({
  header,
}: {
  header: WorkflowTraceHeaderModel;
}) {
  return (
    <ComposedPageHeader
      className="h-auto min-h-16 items-start gap-3 border-b border-border px-4 py-3 sm:items-center sm:border-0 sm:py-4"
      leadingContent={
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          {header.registerSession ? (
            <RegisterSessionIdentity
              registerSession={header.registerSession}
              showSessionCode
            />
          ) : (
            <h1 className="min-w-0 truncate text-base font-semibold leading-5 text-foreground sm:text-sm">
              {header.title}
            </h1>
          )}
          <span className="whitespace-nowrap text-xs text-muted-foreground sm:text-sm">
            / History
          </span>
        </div>
      }
    />
  );
}

export function WorkflowTraceTimeline({
  currency = "GHS",
  events,
}: {
  currency?: string;
  events: WorkflowTraceEventModel[];
}) {
  const { orgUrlSlug, storeUrlSlug } = useParams({ strict: false });
  const orderedEvents = [...events].sort((left, right) => {
    if (left.occurredAt !== right.occurredAt) {
      return left.occurredAt - right.occurredAt;
    }

    return left.sequence - right.sequence;
  });

  return (
    <section className="space-y-6 p-4 sm:p-6">
      <div>
        <p className="text-sm font-medium">Timeline</p>
      </div>

      <ol className="space-y-8">
        {orderedEvents.map((event) => {
          const lifecycleStatement = getLifecycleStatement(event, currency);
          const transactionStatement = getTransactionStatement(event, currency);
          const transactionNumber =
            typeof event.details?.transactionNumber === "string"
              ? event.details.transactionNumber
              : null;
          const transactionId =
            typeof event.details?.transactionId === "string"
              ? event.details.transactionId
              : null;
          const canLinkTransaction = Boolean(
            transactionId && transactionNumber && orgUrlSlug && storeUrlSlug,
          );
          return (
            <li
              key={`${event.traceId}-${event.sequence}-${event.step}`}
              className="flex items-start"
            >
              <div className="space-y-2">
                <div className="flex items-center">
                  <Circle className="h-2 w-2 mt-1 mr-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {canLinkTransaction ? (
                      <>
                        {transactionStatement ||
                          lifecycleStatement ||
                          event.message ||
                          formatTraceLabel(event.step)}{" "}
                        <Link
                          className="inline-flex items-center gap-0.5 font-medium text-foreground underline-offset-2 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          data-remote-assist-control="workflow-trace-transaction"
                          data-remote-assist-control-id={`workflow-trace-transaction-${transactionId}`}
                          data-remote-assist-control-label={`Open transaction ${transactionNumber}`}
                          data-remote-assist-control-role="link"
                          params={{
                            orgUrlSlug: orgUrlSlug!,
                            storeUrlSlug: storeUrlSlug!,
                            transactionId: transactionId!,
                          }}
                          search={{ o: getOrigin() }}
                          to="/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId"
                        >
                          Open #{transactionNumber}
                          <ArrowUpRight
                            aria-hidden="true"
                            className="h-3 w-3"
                          />
                        </Link>
                      </>
                    ) : (
                      lifecycleStatement ||
                      transactionStatement ||
                      event.message ||
                      formatTraceLabel(event.step)
                    )}
                  </p>
                </div>
                <p className="text-xs ml-4 text-muted-foreground">
                  <RelativeTimestamp value={event.occurredAt} />
                  {` · ${formatTraceLabel(event.status)} · ${formatTraceLabel(event.kind)}`}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function WorkflowTraceView({
  storeId,
  traceId,
}: {
  storeId: Id<"store">;
  traceId: string;
}) {
  const terminal = useGetTerminal();
  const workflowTrace = useQuery(
    api.workflowTraces.public.getWorkflowTraceViewById,
    {
      storeId,
      terminalId: terminal?._id,
      traceId,
    },
  );

  if (workflowTrace === undefined) {
    return null;
  }

  if (!workflowTrace) {
    return <NotFoundView entity="workflow trace" entityIdentifier={traceId} />;
  }

  return (
    <View header={<WorkflowTraceHeader header={workflowTrace.header} />}>
      <FadeIn>
        <WorkflowTraceTimeline
          currency={workflowTrace.currency}
          events={workflowTrace.events}
        />
        {workflowTrace.eventsTruncated ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Showing the first{" "}
            {workflowTrace.eventLimit ?? MAX_WORKFLOW_TRACE_EVENTS} trace
            events. Use the source records for the complete history.
          </p>
        ) : null}
      </FadeIn>
    </View>
  );
}

export default WorkflowTraceView;
