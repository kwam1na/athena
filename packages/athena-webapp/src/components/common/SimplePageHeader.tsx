import { useNavigateBack } from "~/src/hooks/use-navigate-back";
import PageHeader from "./PageHeader";
import { Button } from "../ui/button";
import { ArrowLeftIcon } from "lucide-react";

export const SimplePageHeader = ({ title }: { title: string }) => {
  const navigateBack = useNavigateBack();

  return (
    <PageHeader>
      <div className="flex items-center gap-4">
        <Button
          onClick={navigateBack}
          variant="ghost"
          className="h-8 px-2 lg:px-3 "
        >
          <ArrowLeftIcon className="h-4 w-4" />
        </Button>
        <p className="text-sm">{title}</p>
      </div>
    </PageHeader>
  );
};
