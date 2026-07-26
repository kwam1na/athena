import { InlineAlert } from "../ui/inline-alert";

interface ErrorMessageProps {
  message: string;
}

export const ErrorMessage = ({ message }: ErrorMessageProps) => (
  <InlineAlert tone="danger" title="Review not submitted">
    {message}
  </InlineAlert>
);
