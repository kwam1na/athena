import { columns, CombinedAnalyticUser } from "./combined-users-table/columns";
import { CombinedUsersTable } from "./combined-users-table/data-table";
import { snakeCaseToWords } from "~/src/lib/utils";

export default function AnalyticsCombinedUsers({
  items,
}: {
  items: CombinedAnalyticUser[];
}) {
  const data = items.map((item) => ({
    ...item,
    mostRecentAction: snakeCaseToWords(item.mostRecentAction),
  }));

  return <CombinedUsersTable data={data} pageSize={5} columns={columns} />;
}
