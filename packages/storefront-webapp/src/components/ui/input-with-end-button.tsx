import { Input } from "@/components/ui/input";
import { useId } from "react";
import { Icons } from "./icons";

export default function InputWithEndButton({
  onButtonClick,
  buttonText,
  isLoading,
  placeholder,
  value,
  onInputChange,
  onKeyDown,
}: {
  isLoading: boolean;
  onButtonClick: () => void;
  buttonText: string;
  placeholder?: string;
  value?: string;
  onInputChange?: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <div className="flex rounded-lg shadow-sm shadow-black/5">
        <Input
          id={id}
          value={value}
          onChange={(e) => onInputChange?.(e.target.value)}
          onKeyDown={onKeyDown}
          className="-me-px flex-1 rounded-e-none shadow-none focus-visible:z-10"
          placeholder={placeholder}
          type="text"
          disabled={isLoading}
        />
        <button
          onClick={onButtonClick}
          type="button"
          disabled={isLoading}
          className="inline-flex items-center rounded-e-lg border border-input bg-background px-3 text-sm font-medium text-foreground outline-offset-2 transition-colors hover:bg-accent2 hover:text-white focus:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {!isLoading && buttonText}
          {isLoading && (
            <Icons.spinner className="w-4 h-4 animate-spin text-accent4" />
          )}
        </button>
      </div>
    </div>
  );
}
