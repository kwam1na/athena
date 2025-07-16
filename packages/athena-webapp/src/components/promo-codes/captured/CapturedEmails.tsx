import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { GenericDataTable } from "../../base/table/data-table";
import { capturedEmailsColumns } from "./captured-emails-columns";
import { Id } from "~/convex/_generated/dataModel";
import { Offer } from "~/types";

interface CapturedEmailsProps {
  offers?: Offer[];
}

export default function CapturedEmails({ offers }: CapturedEmailsProps = {}) {
  if (!offers) return null;

  return <GenericDataTable data={offers} columns={capturedEmailsColumns} />;
}
