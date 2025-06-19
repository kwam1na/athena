import { Info } from "lucide-react";

export const PrintInstructions = () => {
  return (
    <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-md">
      <div className="flex items-start gap-2">
        <Info className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-blue-800">
          <strong>For thermal receipt printers:</strong>
          <br />
          1. Select your thermal printer as destination
          <br />
          2. In "More settings": Set paper size to "Custom" or "80mm"
          <br />
          3. Set margins to "None" or "Minimum"
        </div>
      </div>
    </div>
  );
};
