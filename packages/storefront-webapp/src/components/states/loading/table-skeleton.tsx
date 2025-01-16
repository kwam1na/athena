import { Skeleton } from "@/components/ui/skeleton";

const TableSkeleton = () => {
  return (
    <div className="flex flex-col gap-8 h-full w-full">
      <div className="flex justify-between w-full">
        <Skeleton className="w-[320px] h-[48px]" />
      </div>
      <Skeleton className="w-full h-[400px]" />
    </div>
  );
};

export default TableSkeleton;
