import { render } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AppMessagesProvider,
  useAppMessage,
  useAppMessageCommunicationPreference,
} from "@/lib/app-messages";
import { AppMessageHost } from "./AppMessageHost";

const toastMock = vi.hoisted(() => ({
  show: vi.fn(),
  message: vi.fn(),
  custom: vi.fn(),
  dismiss: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(toastMock.show, {
    message: toastMock.message,
    custom: toastMock.custom,
    dismiss: toastMock.dismiss,
  }),
}));

function ToastPreference() {
  useAppMessageCommunicationPreference({
    surfaceId: "test-surface",
    variant: "toast",
  });

  return null;
}

function TestMessage({
  id,
  priority = 10,
  toastId,
}: {
  id: string;
  priority?: number;
  toastId: string;
}) {
  useAppMessage({
    id,
    active: true,
    label: id,
    message: `${id} message`,
    priority,
    toastId,
  });

  return null;
}

function ToggleMessage({
  id,
  onRendered,
  toastId,
}: {
  id: string;
  onRendered?: () => void;
  toastId: string;
}) {
  useEffect(() => {
    onRendered?.();
  }, [onRendered]);

  return <TestMessage id={id} toastId={toastId} />;
}

describe("AppMessageHost", () => {
  beforeEach(() => {
    toastMock.show.mockReset();
    toastMock.message.mockReset();
    toastMock.custom.mockReset();
    toastMock.dismiss.mockReset();
  });

  it("dismisses the previous persistent toast when the selected message id changes", () => {
    const { rerender } = render(
      <AppMessagesProvider>
        <ToastPreference />
        <ToggleMessage id="first" toastId="toast-first" />
        <AppMessageHost />
      </AppMessagesProvider>,
    );

    expect(toastMock.message).toHaveBeenLastCalledWith(
      "first message",
      expect.objectContaining({ id: "toast-first" }),
    );

    rerender(
      <AppMessagesProvider>
        <ToastPreference />
        <ToggleMessage id="second" toastId="toast-second" />
        <AppMessageHost />
      </AppMessagesProvider>,
    );

    expect(toastMock.dismiss).toHaveBeenCalledWith("toast-first");
    expect(toastMock.message).toHaveBeenLastCalledWith(
      "second message",
      expect.objectContaining({ id: "toast-second" }),
    );
  });

  it("dismisses an active persistent toast when the host unmounts", () => {
    const { unmount } = render(
      <AppMessagesProvider>
        <ToastPreference />
        <TestMessage id="first" toastId="toast-first" />
        <AppMessageHost />
      </AppMessagesProvider>,
    );

    expect(toastMock.message).toHaveBeenLastCalledWith(
      "first message",
      expect.objectContaining({ id: "toast-first" }),
    );

    unmount();

    expect(toastMock.dismiss).toHaveBeenCalledWith("toast-first");
  });
});
