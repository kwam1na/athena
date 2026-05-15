import { PinInput } from "@/components/pos/PinInput";
import { STAFF_PIN_LENGTH, normalizeStaffPin } from "./staffPinPolicy";

type StaffPinInputProps = {
  "aria-label"?: string;
  disabled: boolean;
  id?: string;
  onChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  value: string;
};

export function StaffPinInput({
  disabled,
  onChange,
  onKeyDown,
  value,
}: StaffPinInputProps) {
  return (
    <PinInput
      value={value}
      onChange={(nextValue) => onChange(normalizeStaffPin(nextValue))}
      disabled={disabled}
      onKeyDown={onKeyDown}
      maxLength={STAFF_PIN_LENGTH}
      size="sm"
    />
  );
}
