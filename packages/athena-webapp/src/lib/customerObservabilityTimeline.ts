import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Eye,
  Monitor,
  MousePointerClick,
  Smartphone,
  XCircle,
} from "lucide-react";
import { capitalizeFirstLetter, snakeCaseToWords } from "./utils";

export type CustomerObservabilityTimelineEvent = {
  _id: string;
  _creationTime: number;
  action: string;
  storeFrontUserId: string;
  storeId: string;
  origin?: string;
  device?: string;
  journey: string;
  step: string;
  status: string;
  sessionId: string;
  route?: string;
  errorCategory?: string;
  errorCode?: string;
  errorMessage?: string;
  productId?: string;
  productSku?: string;
  checkoutSessionId?: string;
  orderId?: string;
  userData?: {
    email?: string;
  };
  productInfo?: {
    name?: string;
    images?: string[];
    price?: number;
    currency?: string;
  };
};

export type CustomerObservabilityTimelineData = {
  summary: {
    totalEvents: number;
    uniqueSessions: number;
    failureCount: number;
    latestEvent?: {
      journey: string;
      step: string;
      status: string;
      _creationTime: number;
    };
  };
  events: CustomerObservabilityTimelineEvent[];
};

export function formatObservabilityLabel(value?: string) {
  if (!value) {
    return "Unknown";
  }

  return capitalizeFirstLetter(snakeCaseToWords(value));
}

export function getObservabilityStatusStyles(status: string) {
  switch (status) {
    case "failed":
      return {
        badgeClassName: "bg-red-100 text-red-800 border-red-200",
        borderClassName: "border-l-red-500 bg-red-50/40",
        icon: AlertTriangle,
      };
    case "blocked":
      return {
        badgeClassName: "bg-amber-100 text-amber-800 border-amber-200",
        borderClassName: "border-l-amber-500 bg-amber-50/40",
        icon: AlertTriangle,
      };
    case "succeeded":
      return {
        badgeClassName: "bg-emerald-100 text-emerald-800 border-emerald-200",
        borderClassName: "border-l-emerald-500 bg-emerald-50/30",
        icon: CheckCircle2,
      };
    case "started":
      return {
        badgeClassName: "bg-blue-100 text-blue-800 border-blue-200",
        borderClassName: "border-l-blue-500 bg-blue-50/30",
        icon: MousePointerClick,
      };
    case "viewed":
      return {
        badgeClassName: "bg-slate-100 text-slate-700 border-slate-200",
        borderClassName: "border-l-slate-300 bg-slate-50/30",
        icon: Eye,
      };
    case "canceled":
      return {
        badgeClassName: "bg-zinc-100 text-zinc-700 border-zinc-200",
        borderClassName: "border-l-zinc-300 bg-zinc-50/30",
        icon: XCircle,
      };
    default:
      return {
        badgeClassName: "bg-slate-100 text-slate-700 border-slate-200",
        borderClassName: "border-l-slate-300 bg-slate-50/30",
        icon: Activity,
      };
  }
}

export function getDeviceIcon(device?: string) {
  if (device === "mobile") {
    return Smartphone;
  }

  if (device === "desktop") {
    return Monitor;
  }

  return undefined;
}
