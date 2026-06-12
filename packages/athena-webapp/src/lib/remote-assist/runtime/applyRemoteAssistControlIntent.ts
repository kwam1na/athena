import {
  collectSensitiveRegions,
} from "./remoteAssistCobrowseRecorder";
import {
  validateRemoteAssistControlIntent,
  type RemoteAssistControlIntent,
  type RemoteAssistControlResult,
} from "@/lib/remote-assist";

const RECENT_CONTROL_RESULT_LIMIT = 100;
const recentControlResultsBySession = new Map<
  string,
  Map<string, RemoteAssistControlResult>
>();

export function applyRemoteAssistControlIntent(args: {
  document?: Document;
  intent: RemoteAssistControlIntent;
  window?: Window;
}): RemoteAssistControlResult {
  const cachedResult = getRecentControlResult(args.intent);
  if (cachedResult) {
    return cachedResult;
  }

  const runtimeWindow = args.window ?? window;
  const runtimeDocument = args.document ?? runtimeWindow.document;
  const viewport = {
    height: runtimeWindow.innerHeight,
    width: runtimeWindow.innerWidth,
  };
  const result = validateRemoteAssistControlIntent({
    intent: args.intent,
    sensitiveRegions: collectSensitiveRegions(runtimeDocument),
    viewport,
  });

  if (!result.accepted) {
    return result;
  }

  if (result.event.type === "pointer") {
    applyPointerEvent(runtimeDocument, result.event);
  } else {
    applyKeyEvent(runtimeDocument, result.event);
  }

  rememberControlResult(result);
  return result;
}

function getRecentControlResult(intent: RemoteAssistControlIntent) {
  return recentControlResultsBySession
    .get(intent.sessionId)
    ?.get(intent.idempotencyKey);
}

function rememberControlResult(result: RemoteAssistControlResult) {
  const sessionResults =
    recentControlResultsBySession.get(result.sessionId) ??
    new Map<string, RemoteAssistControlResult>();
  sessionResults.set(result.idempotencyKey, result);
  while (sessionResults.size > RECENT_CONTROL_RESULT_LIMIT) {
    const oldestKey = sessionResults.keys().next().value;
    if (!oldestKey) {
      break;
    }
    sessionResults.delete(oldestKey);
  }
  recentControlResultsBySession.set(result.sessionId, sessionResults);
}

function applyPointerEvent(
  runtimeDocument: Document,
  event: Extract<RemoteAssistControlIntent["event"], { type: "pointer" }>,
) {
  const target = runtimeDocument.elementFromPoint(event.x, event.y);
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const PointerEventCtor =
    runtimeDocument.defaultView?.PointerEvent ??
    runtimeDocument.defaultView?.MouseEvent;
  if (!PointerEventCtor) {
    return;
  }
  target.dispatchEvent(
    new PointerEventCtor(`pointer${event.action}`, {
      bubbles: true,
      cancelable: true,
      clientX: event.x,
      clientY: event.y,
    }),
  );

  if (event.action === "up") {
    target.click();
  }
}

function applyKeyEvent(
  runtimeDocument: Document,
  event: Extract<RemoteAssistControlIntent["event"], { type: "key" }>,
) {
  const target =
    runtimeDocument.activeElement instanceof HTMLElement
      ? runtimeDocument.activeElement
      : runtimeDocument.body;
  target.dispatchEvent(
    new KeyboardEvent(`key${event.action}`, {
      bubbles: true,
      cancelable: true,
      code: event.code,
      key: event.code,
    }),
  );
}
