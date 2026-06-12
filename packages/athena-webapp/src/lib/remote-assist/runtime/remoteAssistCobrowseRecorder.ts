import {
  buildRemoteAssistCoBrowseFrame,
  maskTextForRemoteAssist,
  type RemoteAssistCoBrowseFrame,
  type RemoteAssistSanitizedSurface,
  type RemoteAssistSensitiveRegion,
} from "@/lib/remote-assist";

const MAX_VISIBLE_TEXT_ITEMS = 24;
const MAX_CONTROL_TARGETS = 24;
const CONTROL_ID_ATTRIBUTE = "data-remote-assist-control-id";
const SENSITIVE_SELECTOR =
  "[data-remote-assist-sensitive], [data-sensitive], input[type='password'], input[type='tel'], input[type='email'], input[type='number'], textarea";
const CONTROL_SELECTOR =
  "button, a[href], input, select, textarea, [role='button'], [data-remote-assist-control]";

export function captureRemoteAssistCoBrowseFrame(args: {
  document?: Document;
  frameId: string;
  now?: number;
  sessionId: string;
  window?: Window;
}): RemoteAssistCoBrowseFrame {
  const runtimeWindow = args.window ?? window;
  const runtimeDocument = args.document ?? runtimeWindow.document;
  const viewport = {
    height: runtimeWindow.innerHeight,
    width: runtimeWindow.innerWidth,
  };
  const sensitiveRegions = collectSensitiveRegions(runtimeDocument);
  const surface = collectSanitizedSurface(runtimeDocument);

  return buildRemoteAssistCoBrowseFrame({
    capturedAt: args.now ?? Date.now(),
    frameId: args.frameId,
    route: runtimeWindow.location.pathname || "/",
    sensitiveRegions,
    sessionId: args.sessionId,
    surface,
    viewport,
  });
}

export function collectSensitiveRegions(
  runtimeDocument: Document,
): RemoteAssistSensitiveRegion[] {
  return Array.from(runtimeDocument.querySelectorAll<HTMLElement>(SENSITIVE_SELECTOR))
    .map((element, index) => {
      const rect = element.getBoundingClientRect();
      return {
        id:
          element.getAttribute("data-remote-assist-sensitive") ||
          element.id ||
          `sensitive-${index + 1}`,
        label:
          element.getAttribute("aria-label") ||
          element.getAttribute("name") ||
          element.tagName.toLowerCase(),
        rect: {
          height: rect.height,
          width: rect.width,
          x: rect.x,
          y: rect.y,
        },
      };
    })
    .filter((region) => region.rect.width > 0 && region.rect.height > 0);
}

function collectSanitizedSurface(runtimeDocument: Document): RemoteAssistSanitizedSurface {
  const blockedElements = new Set<Element>(
    Array.from(runtimeDocument.querySelectorAll(SENSITIVE_SELECTOR)),
  );
  const visibleText = collectVisibleText(runtimeDocument, blockedElements);
  const controls = Array.from(
    runtimeDocument.querySelectorAll<HTMLElement>(CONTROL_SELECTOR),
  )
    .filter((element) => isVisibleElement(element))
    .filter((element) => !isInsideSensitiveElement(element, blockedElements))
    .map((element, index) => {
      const rect = element.getBoundingClientRect();
      const controlId = ensureControlId(element, index);
      return {
        controlId,
        label: maskTextForRemoteAssist(getElementLabel(element)),
        rect: {
          height: rect.height,
          width: rect.width,
          x: rect.x,
          y: rect.y,
        },
        role: getElementRole(element),
      };
    })
    .filter((control) => control.rect.width > 0 && control.rect.height > 0)
    .slice(0, MAX_CONTROL_TARGETS);

  const activeElement = runtimeDocument.activeElement;
  const focusedControlId =
    activeElement instanceof HTMLElement
      ? activeElement.getAttribute(CONTROL_ID_ATTRIBUTE) ?? undefined
      : undefined;

  return {
    controls,
    focusedControlId,
    title: maskTextForRemoteAssist(runtimeDocument.title || "Athena POS"),
    visibleText,
  };
}

function collectVisibleText(
  runtimeDocument: Document,
  blockedElements: Set<Element>,
) {
  const walker = runtimeDocument.createTreeWalker(
    runtimeDocument.body,
    NodeFilter.SHOW_TEXT,
  );
  const textItems: string[] = [];

  while (walker.nextNode() && textItems.length < MAX_VISIBLE_TEXT_ITEMS) {
    const node = walker.currentNode;
    const parent = node.parentElement;
    const value = node.textContent?.replace(/\s+/g, " ").trim();
    if (!parent || !value || value.length < 2) {
      continue;
    }
    if (!isVisibleElement(parent) || isInsideSensitiveElement(parent, blockedElements)) {
      continue;
    }
    textItems.push(maskTextForRemoteAssist(value).slice(0, 120));
  }

  return Array.from(new Set(textItems));
}

function ensureControlId(element: HTMLElement, index: number) {
  const existing = element.getAttribute(CONTROL_ID_ATTRIBUTE);
  if (existing) {
    return existing;
  }
  const controlId = `remote-assist-control-${index + 1}`;
  element.setAttribute(CONTROL_ID_ATTRIBUTE, controlId);
  return controlId;
}

function getElementLabel(element: HTMLElement) {
  return (
    element.getAttribute("aria-label") ||
    element.getAttribute("title") ||
    element.textContent ||
    element.getAttribute("placeholder") ||
    element.getAttribute("name") ||
    element.tagName.toLowerCase()
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function getElementRole(
  element: HTMLElement,
): RemoteAssistSanitizedSurface["controls"][number]["role"] {
  const tagName = element.tagName.toLowerCase();
  if (tagName === "a") {
    return "link";
  }
  if (tagName === "input" || tagName === "textarea") {
    return "input";
  }
  if (tagName === "select") {
    return "select";
  }
  if (tagName === "button" || element.getAttribute("role") === "button") {
    return "button";
  }
  return "control";
}

function isInsideSensitiveElement(
  element: Element,
  blockedElements: Set<Element>,
) {
  for (const blockedElement of blockedElements) {
    if (blockedElement === element || blockedElement.contains(element)) {
      return true;
    }
  }
  return false;
}

function isVisibleElement(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style?.visibility !== "hidden" &&
    style?.display !== "none"
  );
}
