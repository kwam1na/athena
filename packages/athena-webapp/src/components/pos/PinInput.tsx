import { OTPInput, SlotProps } from "input-otp";
import { cn } from "~/src/lib/utils";

interface PinInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  onKeyDown: (e: React.KeyboardEvent) => void;
  maxLength: number;
  size?: "sm" | "md" | "lg";
}

export const PinInput = ({
  value,
  onChange,
  disabled,
  onKeyDown,
  maxLength,
  size = "md",
}: PinInputProps) => {
  const slotSizeClass = SLOT_SIZE_CLASSES[size];
  return (
    <OTPInput
      maxLength={maxLength}
      value={value}
      onChange={onChange}
      disabled={disabled}
      onKeyDown={onKeyDown}
      containerClassName="group flex items-center has-[:disabled]:opacity-30"
      render={({ slots }) => (
        <>
          <div className="flex">
            {slots.slice(0, 3).map((slot, idx) => (
              <Slot key={idx} {...slot} sizeClass={slotSizeClass} />
            ))}
          </div>

          <FakeDash />

          <div className="flex">
            {slots.slice(3).map((slot, idx) => (
              <Slot key={idx} {...slot} sizeClass={slotSizeClass} />
            ))}
          </div>
        </>
      )}
    />
  );
};

const SLOT_SIZE_CLASSES: Record<NonNullable<PinInputProps["size"]>, string> = {
  sm: "w-12 h-12 text-xl",
  md: "w-16 h-16 text-[2rem]",
  lg: "w-20 h-20 text-[2.5rem]",
};

// Feel free to copy. Uses @shadcn/ui tailwind colors.
function Slot({ sizeClass, ...props }: SlotProps & { sizeClass: string }) {
  return (
    <div
      className={cn(
        "relative",
        sizeClass,
        "flex items-center justify-center",
        "transition-all duration-300",
        "border-border border-y border-r first:border-l first:rounded-l-md last:rounded-r-md",
        "group-hover:border-accent-foreground/20 group-focus-within:border-accent-foreground/20",
        "outline outline-0 outline-accent-foreground/20",
        { "outline-1 outline-accent-foreground": props.isActive }
      )}
    >
      {props.char !== null && <div>•</div>}
    </div>
  );
}

// You can emulate a fake textbox caret!
function FakeCaret() {
  return (
    <div className="absolute pointer-events-none inset-0 flex items-center justify-center animate-caret-blink">
      <div className="w-px h-8 bg-white" />
    </div>
  );
}

// Inspired by Stripe's MFA input.
function FakeDash() {
  return (
    <div className="flex w-10 justify-center items-center">
      <div className="w-3 h-1 rounded-full bg-border" />
    </div>
  );
}
