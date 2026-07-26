import * as React from "react";

import { cn } from "@/lib/utils";
import { Label } from "./label";

type FieldControlProps = {
  id?: string;
  disabled?: boolean;
  required?: boolean;
  "aria-describedby"?: string;
  "aria-errormessage"?: string;
  "aria-invalid"?: boolean | "false" | "true";
  "aria-required"?: boolean | "false" | "true";
};

export interface FieldProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  disabled?: boolean;
  children: React.ReactElement<FieldControlProps>;
}

const Field = React.forwardRef<HTMLDivElement, FieldProps>(
  (
    {
      label,
      hint,
      error,
      required = false,
      disabled = false,
      children,
      className,
      ...props
    },
    ref,
  ) => {
    const generatedId = React.useId();
    const controlId = children.props.id ?? `${generatedId}-control`;
    const hintId = `${generatedId}-hint`;
    const errorId = `${generatedId}-error`;
    const describedBy = [
      children.props["aria-describedby"],
      hint ? hintId : undefined,
      error ? errorId : undefined,
    ]
      .filter(Boolean)
      .join(" ");

    const control = React.cloneElement(children, {
      id: controlId,
      disabled: disabled || children.props.disabled,
      required: required || children.props.required,
      "aria-required": required || children.props["aria-required"] || undefined,
      "aria-invalid": Boolean(error) || children.props["aria-invalid"] || undefined,
      "aria-describedby": describedBy || undefined,
      "aria-errormessage": error ? errorId : children.props["aria-errormessage"],
    });

    return (
      <div
        ref={ref}
        className={cn("space-y-2", className)}
        data-disabled={disabled || undefined}
        data-invalid={Boolean(error) || undefined}
        {...props}
      >
        <Label
          htmlFor={controlId}
          className={cn(
            error && "text-danger",
            disabled && "cursor-not-allowed opacity-70",
          )}
        >
          {label}
          {required && (
            <span aria-hidden="true" className="ml-1 text-danger">
              *
            </span>
          )}
        </Label>
        {control}
        {hint && (
          <p id={hintId} className="text-sm text-muted-foreground">
            {hint}
          </p>
        )}
        {error && (
          <p
            id={errorId}
            role="alert"
            className="text-sm font-medium text-danger"
          >
            {error}
          </p>
        )}
      </div>
    );
  },
);
Field.displayName = "Field";

export { Field };
