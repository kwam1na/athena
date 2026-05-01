import {
  type ApprovalCommandResult,
  type ApprovalRequiredResult,
  type CommandResult,
  GENERIC_UNEXPECTED_ERROR_MESSAGE,
  GENERIC_UNEXPECTED_ERROR_TITLE,
} from "~/shared/commandResult";

export type ApprovalRequiredCommandResult = ApprovalRequiredResult;

export type UnexpectedErrorResult = {
  kind: "unexpected_error";
  error: {
    title: string;
    message: string;
    traceId?: string;
  };
};

export type NormalizedCommandResult<T> =
  | CommandResult<T>
  | UnexpectedErrorResult;

export type NormalizedApprovalCommandResult<T> =
  | ApprovalCommandResult<T>
  | UnexpectedErrorResult;

export function isApprovalRequiredResult<T>(
  result: NormalizedApprovalCommandResult<T>,
): result is ApprovalRequiredResult {
  return result.kind === "approval_required";
}

function extractTraceId(error: unknown): string | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  return error.message.match(/trace[:=]\s*([a-z0-9_-]+)/i)?.[1];
}

export function runCommand<T>(
  command: () => Promise<CommandResult<T>> | CommandResult<T>,
): Promise<NormalizedCommandResult<T>>;
export function runCommand<T>(
  command: () => Promise<ApprovalCommandResult<T>> | ApprovalCommandResult<T>,
): Promise<NormalizedApprovalCommandResult<T>>;
export async function runCommand<T>(
  command: () => Promise<ApprovalCommandResult<T>> | ApprovalCommandResult<T>,
): Promise<NormalizedApprovalCommandResult<T>> {
  try {
    return await command();
  } catch (error) {
    console.error("Unexpected command failure", error);

    return {
      kind: "unexpected_error",
      error: {
        title: GENERIC_UNEXPECTED_ERROR_TITLE,
        message: GENERIC_UNEXPECTED_ERROR_MESSAGE,
        traceId: extractTraceId(error),
      },
    };
  }
}
