import { Analytic, BagItem } from "~/types";
import { columns } from "./analytics-data-table/columns";
import { LogItemsDataTable } from "./analytics-data-table/data-table";
import { AnimatePresence, motion } from "framer-motion";

export default function LogItems({
  items,
  pageIndex,
}: {
  items: Analytic[];
  pageIndex: number;
}) {
  return (
    <AnimatePresence>
      <div className="container mx-auto">
        <motion.div
          className="py-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <LogItemsDataTable
            data={items}
            columns={columns}
            pageIndex={pageIndex}
          />
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
