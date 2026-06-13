import {
  buildRemoteAssistCoBrowseFrame,
  maskTextForRemoteAssist,
  type RemoteAssistCoBrowseFrame,
  type RemoteAssistSanitizedSurface,
  type RemoteAssistSensitiveRegion,
} from "@/lib/remote-assist";

const MAX_VISIBLE_TEXT_ITEMS = 24;
const MAX_CONTROL_TARGETS = 24;
const CONTROL_ATTRIBUTE = "data-remote-assist-control";
const CONTROL_ID_ATTRIBUTE = "data-remote-assist-control-id";
const CONTROL_LABEL_ATTRIBUTE = "data-remote-assist-control-label";
const CONTROL_ROLE_ATTRIBUTE = "data-remote-assist-control-role";
const GENERIC_CONTROL_IDS = new Set(["sidebar-menu-button"]);
const SENSITIVE_SELECTOR =
  "[data-remote-assist-sensitive], [data-sensitive], input[type='password'], input[type='tel'], input[type='email'], input[type='number'], textarea";
const CONTROL_SELECTOR = `[${CONTROL_ATTRIBUTE}]`;

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
  return Array.from(
    runtimeDocument.querySelectorAll<HTMLElement>(SENSITIVE_SELECTOR),
  )
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

function collectSanitizedSurface(
  runtimeDocument: Document,
): RemoteAssistSanitizedSurface {
  const blockedElements = new Set<Element>(
    Array.from(runtimeDocument.querySelectorAll(SENSITIVE_SELECTOR)),
  );
  const visibleText = collectVisibleText(runtimeDocument, blockedElements);
  const controls = Array.from(
    runtimeDocument.querySelectorAll<HTMLElement>(CONTROL_SELECTOR),
  )
    .flatMap((element, order) => {
      if (
        !isVisibleElement(element) ||
        isInsideSensitiveElement(element, blockedElements)
      ) {
        return [];
      }
      const rect = element.getBoundingClientRect();
      const controlId = getControlId(element);
      return controlId
        ? [
            {
              control: {
                controlId,
                label: maskTextForRemoteAssist(getElementLabel(element)),
                rect: {
                  height: rect.height,
                  width: rect.width,
                  x: rect.x,
                  y: rect.y,
                },
                role: getElementRole(element),
              },
              order,
              priority: getControlPriority(element),
            },
          ]
        : [];
    })
    .filter(({ control }) => control.rect.width > 0 && control.rect.height > 0)
    .sort(
      (left, right) =>
        left.priority - right.priority || left.order - right.order,
    )
    .slice(0, MAX_CONTROL_TARGETS)
    .sort((left, right) => left.order - right.order)
    .map(({ control }) => control);

  const activeElement = runtimeDocument.activeElement;
  const focusedControlId =
    activeElement instanceof HTMLElement &&
    activeElement.matches(CONTROL_SELECTOR)
      ? (getControlId(activeElement) ?? undefined)
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
    if (
      !isVisibleElement(parent) ||
      isInsideSensitiveElement(parent, blockedElements)
    ) {
      continue;
    }
    textItems.push(maskTextForRemoteAssist(value).slice(0, 120));
  }

  return Array.from(new Set(textItems));
}

function getControlId(element: HTMLElement) {
  const explicitControlId = normalizeAttributeValue(
    element.getAttribute(CONTROL_ID_ATTRIBUTE),
  );
  if (explicitControlId) {
    return explicitControlId;
  }

  const controlId = normalizeAttributeValue(
    element.getAttribute(CONTROL_ATTRIBUTE),
  );
  if (controlId && !GENERIC_CONTROL_IDS.has(controlId)) {
    return controlId;
  }

  const elementId = normalizeAttributeValue(element.id);
  if (elementId) {
    return elementId;
  }

  return buildGeneratedControlId(element);
}

function getControlPriority(element: HTMLElement) {
  const controlId = normalizeAttributeValue(
    element.getAttribute(CONTROL_ID_ATTRIBUTE),
  );
  if (controlId) {
    return 0;
  }

  const control = normalizeAttributeValue(
    element.getAttribute(CONTROL_ATTRIBUTE),
  );
  if (control && !GENERIC_CONTROL_IDS.has(control)) {
    return 1;
  }

  return 2;
}

function getElementLabel(element: HTMLElement) {
  return (
    element.getAttribute(CONTROL_LABEL_ATTRIBUTE) ||
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
  const explicitRole = element.getAttribute(CONTROL_ROLE_ATTRIBUTE);
  if (isRemoteAssistControlRole(explicitRole)) {
    return explicitRole;
  }

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

function normalizeAttributeValue(value: string | null) {
  const normalized = value?.trim();
  if (!normalized || normalized === "true") {
    return null;
  }
  return normalized;
}

function buildGeneratedControlId(element: HTMLElement) {
  const role = getElementRole(element);
  const label = getElementLabel(element);
  const route =
    element instanceof HTMLAnchorElement
      ? sanitizeHrefForControlId(element.getAttribute("href"))
      : null;
  const slug = slugifyControlId([role, label, route].filter(Boolean).join("-"));

  return slug ? `remote-assist-${slug}` : null;
}

function sanitizeHrefForControlId(href: string | null) {
  if (!href) {
    return null;
  }
  try {
    const parsedHref = new URL(href, "https://athena.local");
    return parsedHref.pathname;
  } catch {
    return href.split("?")[0]?.split("#")[0] ?? null;
  }
}

function slugifyControlId(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function isRemoteAssistControlRole(
  value: string | null,
): value is RemoteAssistSanitizedSurface["controls"][number]["role"] {
  return (
    value === "button" ||
    value === "control" ||
    value === "input" ||
    value === "link" ||
    value === "select"
  );
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
