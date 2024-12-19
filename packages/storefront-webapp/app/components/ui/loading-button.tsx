import * as React from "react";
import { Button, ButtonProps } from "./button";
import { Icons } from "./icons";

interface LoadingButtonProps extends ButtonProps {
  isLoading: boolean;
}

export const LoadingButton: React.FC<LoadingButtonProps> = ({
  isLoading,
  children,
  ...props
}) => {
  return (
    <Button {...props} disabled={props.disabled}>
      {!isLoading && children}
      {isLoading && <Icons.spinner className="ml-2 h-4 w-4 animate-spin" />}
    </Button>
  );
};
