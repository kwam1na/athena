import { ALL_COUNTRIES } from "@/lib/countries";

export const CountrySelect = ({
  value,
  onSelect,
}: {
  value?: string;
  onSelect: (country: string) => void;
}) => {
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">Country</p>
      <select
        value={value || ""}
        onChange={(e) => {
          onSelect(e.target.value);
        }}
        className="py-2 bg-white text-black"
      >
        {/* Placeholder option */}
        <option value="" disabled>
          Select a country
        </option>
        {ALL_COUNTRIES.map((country) => (
          <option key={country.code} value={country.code}>
            {country.name}
          </option>
        ))}
      </select>
    </div>
  );
};
