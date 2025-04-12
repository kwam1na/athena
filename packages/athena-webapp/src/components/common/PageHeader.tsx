import { useNavigateBack } from "~/src/hooks/use-navigate-back";
import { Button } from "../ui/button";
import { ArrowLeftIcon } from "lucide-react";

const PageHeader = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="container mx-auto py-6 px-4 flex gap-2 h-[40px] items-center justify-between">
      {children}
    </div>
  );
};

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

export const ComposedPageHeader = ({
  leadingContent,
  trailingContent,
}: {
  leadingContent: React.ReactNode;
  trailingContent?: React.ReactNode;
}) => {
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
        {leadingContent}
      </div>

      {trailingContent}
    </PageHeader>
  );
};

export default PageHeader;
