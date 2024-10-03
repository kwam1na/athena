import { Skeleton } from "@/components/ui/skeleton";

const DashboardSkeleton = () => {
  return (
    <div className="flex flex-col gap-8 justify-between w-full pr-6">
      <div className="flex flex-col gap-4">
        <Skeleton className="w-[280px] h-[32px]" />
        <Skeleton className="w-[320px] h-[24px]" />
      </div>
      <div className="flex flex-col gap-4 lg:flex-row justify-between w-full">
        <Skeleton className="w-full lg:w-[33%] h-[160px]" />
        <Skeleton className="w-full lg:w-[33%] h-[160px]" />
        <Skeleton className="w-full lg:w-[33%] h-[160px]" />
      </div>

      <div className="flex flex-col lg:flex-row gap-8 w-full">
        <div className="flex flex-col gap-4 w-full lg:w-[50%]">
          <Skeleton className="w-full h-[160px]" />
          <div className="flex flex-row gap-4">
            <Skeleton className="w-full lg:w-[50%] h-[160px]" />
            <Skeleton className="w-full lg:w-[50%] h-[160px]" />
          </div>
          <Skeleton className="w-full h-[300px]" />
        </div>

        <div className="gap-4 w-full lg:w-[50%]">
          <Skeleton className="w-full h-[600px]" />
        </div>
      </div>
    </div>
  );
};

export default DashboardSkeleton;
