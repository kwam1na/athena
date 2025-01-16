import { GHANA_REGIONS } from "@/lib/ghanaRegions";

export const GhanaRegionSelect = ({
  value,
  onSelect,
  disabled,
}: {
  disabled?: boolean;
  value?: string;
  onSelect: (region: string) => void;
}) => {
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">Region</p>
      <select
        disabled={disabled}
        value={value || ""}
        onChange={(e) => {
          onSelect(e.target.value);
        }}
        className="py-2 bg-white text-black"
      >
        {/* Placeholder option */}
        <option value="" disabled>
          Select region
        </option>
        {GHANA_REGIONS.map((region) => (
          <option key={region.code} value={region.code}>
            {region.name}
          </option>
        ))}
      </select>
    </div>
  );
};
