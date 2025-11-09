import { AlertCircle } from "lucide-react";

interface NoResultsMessageProps {
  show: boolean;
}

export function NoResultsMessage({ show }: NoResultsMessageProps) {
  if (!show) return null;

  return (
    <div className="p-4 bg-amber-50 border-2 border-amber-200 rounded-lg">
      <div className="flex items-center gap-3 text-amber-700">
        <div className="w-8 h-8 bg-amber-200 rounded-full flex items-center justify-center flex-shrink-0">
          <AlertCircle className="w-4 h-4" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold">No product found</p>
          <p className="text-xs text-amber-600 mt-1">
            The barcode/QR code doesn't match any products in the system
          </p>
        </div>
      </div>
    </div>
  );
}
