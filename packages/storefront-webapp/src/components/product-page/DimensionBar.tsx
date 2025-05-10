import React from "react";
import { Review } from "@athena/webapp";

interface DimensionBarProps {
  reviews: Review[];
  dimensionKey: string;
  labels: string[];
  minValue?: number;
  maxValue?: number;
}

function mapValueToLabelIndex(
  value: number,
  minValue: number,
  maxValue: number,
  numLabels: number
): number {
  // Map value in [minValue, maxValue] to [0, numLabels-1]
  if (numLabels === 1) return 0;
  const ratio = (value - minValue) / (maxValue - minValue);
  return Math.round(ratio * (numLabels - 1));
}

export function DimensionBar({
  reviews,
  dimensionKey,
  labels,
  minValue,
  maxValue,
}: DimensionBarProps) {
  // Collect all values for the dimension
  const values = reviews
    .map((review) => {
      const dim = review.ratings.find((r) => r.key === dimensionKey);
      return dim ? dim.value : null;
    })
    .filter((v): v is number => v !== null && v !== undefined);

  if (!values.length) return null;

  // Use provided min/max or infer from data or default to 1–5
  const min = minValue ?? Math.min(...values, 1);
  const max = maxValue ?? Math.max(...values, 5);

  // Map all values to label indices
  const labelIndices = values.map((v) =>
    mapValueToLabelIndex(v, min, max, labels.length)
  );
  const avgIdx = Math.round(
    labelIndices.reduce((a, b) => a + b, 0) / labelIndices.length
  );

  return (
    <div className="w-full flex flex-col items-center my-8">
      {/* Bar */}
      <div className="w-full max-w-xl flex items-center gap-2">
        {labels.map((_, i) => (
          <div
            key={i}
            className={`flex-1 h-3 rounded-full ${i === avgIdx ? "bg-black" : "bg-gray-200"}`}
            style={{
              marginLeft: i === 0 ? 0 : 4,
              marginRight: i === labels.length - 1 ? 0 : 4,
            }}
          />
        ))}
      </div>
      {/* Labels */}
      <div className="w-full max-w-xl flex justify-between mt-2">
        {labels.map((label, i) => (
          <span
            key={label}
            className={`text-sm ${i === avgIdx ? "font-bold" : "text-black"}`}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
