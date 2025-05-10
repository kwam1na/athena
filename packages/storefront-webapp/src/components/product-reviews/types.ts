export type Dimension = {
  key: string;
  label: string;
  optional?: boolean;
};

export type SubmissionStatus = {
  type: "success" | "error" | null;
  message: string;
};

export interface ReviewFormData {
  title: string;
  content: string;
  hairQuality: number;
  trueToLength: number;
  capFit: number;
  styleAppearance: number;
  easeOfInstallation: number;
  overall: number;
  value: number;
  quality: number;
}

export const GENERIC_DIMENSIONS = [
  { key: "overall", label: "Overall", optional: false },
  { key: "value", label: "Value", optional: false },
  { key: "quality", label: "Quality", optional: false },
] as const;

export const HAIR_DIMENSIONS = [
  { key: "hairQuality", label: "Hair Quality", optional: false },
  { key: "trueToLength", label: "True to Length", optional: false },
  { key: "capFit", label: "Cap Fit / Comfort", optional: false },
  { key: "styleAppearance", label: "Style / Appearance", optional: false },
  { key: "easeOfInstallation", label: "Ease of Installation", optional: false },
] as const;

export const STAR_LABELS = [
  "Very poor",
  "Poor",
  "Average",
  "Good",
  "Excellent",
];
