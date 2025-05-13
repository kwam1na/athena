import React, { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";

interface ColorPickerProps {
  color: string;
  onChange: (color: string) => void;
}

export const ColorPicker: React.FC<ColorPickerProps> = ({
  color,
  onChange,
}) => {
  const [inputValue, setInputValue] = useState(color);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const handleBlur = () => {
    onChange(inputValue);
  };

  return (
    <div className="flex items-center gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="border rounded-md h-10 w-10 flex items-center justify-center shadow-sm"
            style={{ backgroundColor: color }}
            aria-label="Choose color"
          />
        </PopoverTrigger>
        <PopoverContent className="w-80">
          <div className="grid gap-4">
            <div className="space-y-2">
              <div className="grid grid-cols-6 gap-2">
                {[
                  "#FFFFFF",
                  "#000000",
                  "#F97316",
                  "#3B82F6",
                  "#10B981",
                  "#EF4444",
                  "#EC4899",
                  "#8B5CF6",
                  "#F59E0B",
                  "#6B7280",
                  "#F3F4F6",
                  "#1E293B",
                ].map((presetColor) => (
                  <button
                    key={presetColor}
                    type="button"
                    className="h-6 w-6 rounded-md border shadow-sm"
                    style={{ backgroundColor: presetColor }}
                    onClick={() => {
                      setInputValue(presetColor);
                      onChange(presetColor);
                    }}
                    aria-label={`Color: ${presetColor}`}
                  />
                ))}
              </div>
            </div>
            <div className="flex">
              <input
                type="color"
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  onChange(e.target.value);
                }}
                className="w-full h-8"
              />
            </div>
            <div>
              <Input
                id="color-value"
                value={inputValue}
                onChange={handleInputChange}
                onBlur={handleBlur}
                className="col-span-3 h-8"
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>
      <Input
        value={inputValue}
        onChange={handleInputChange}
        onBlur={handleBlur}
        className="h-8"
      />
    </div>
  );
};
