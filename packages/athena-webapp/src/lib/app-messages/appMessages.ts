export type AppMessageAction = {
  actionId: string;
  label: string;
  disabled?: boolean;
  iconName?: "download";
  onInvoke: () => void;
};

export type AppMessageInput = {
  id: string;
  label: string;
  message: string;
  compactLabel?: string;
  details?: string;
  detailsLabel?: string;
  priority?: number;
  toastId?: string;
  action?: AppMessageAction;
};

export type AppMessage = AppMessageInput;

export function sortAppMessages(messages: AppMessage[]) {
  return [...messages].sort(compareAppMessages);
}

export function getSelectedAppMessage(messages: AppMessage[]) {
  return sortAppMessages(messages)[0];
}

export function isValidAppMessageInput(message: AppMessageInput) {
  return (
    message.id.length > 0 &&
    message.label.length > 0 &&
    message.message.length > 0
  );
}

function compareAppMessages(left: AppMessage, right: AppMessage) {
  return (
    (right.priority ?? 0) - (left.priority ?? 0) ||
    left.label.localeCompare(right.label) ||
    left.id.localeCompare(right.id)
  );
}
