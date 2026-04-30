import { useNavigateBack } from "~/src/hooks/use-navigate-back";
import { Button } from "../ui/button";
import { ArrowLeftIcon } from "lucide-react";
import { useSearch } from "@tanstack/react-router";
import { cn } from "~/src/lib/utils";
import { FadeIn } from "./FadeIn";

const PageHeader = ({
  children,
  width = "contained",
  className,
}: {
  children: React.ReactNode;
  width?: "contained" | "full";
  className?: string;
}) => {
  return (
    <div
      className={cn(
        width === "full" ? "w-full" : "container mx-auto",
        "py-6 px-4 flex gap-2 h-[40px] items-center justify-between",
        className,
      )}
    >
      {children}
    </div>
  );
};

export const NavigateBackButton = () => {
  const { o } = useSearch({ strict: false });
  const navigateBack = useNavigateBack();

  if (!o) {
    return null;
  }

  return (
    <Button
      onClick={navigateBack}
      variant="ghost"
      className="h-8 px-2 lg:px-3 "
    >
      <ArrowLeftIcon className="h-4 w-4" />
    </Button>
  );
};

export const SimplePageHeader = ({
  title,
  className,
}: {
  title: string;
  className?: string;
}) => {
  return (
    <PageHeader>
      <div className="flex items-center gap-4">
        <NavigateBackButton />
        <p className={cn("text-sm", className)}>{title}</p>
      </div>
    </PageHeader>
  );
};

export const ViewHeader = ({ title }: { title: string }) => {
  return (
    <div className="px-6 py-4">
      <p className="font-semibold">{title}</p>
    </div>
  );
};

export const ComposedPageHeader = ({
  leadingContent,
  trailingContent,
  onNavigateBack,
  disableBackButton = false,
  width = "contained",
  className,
}: {
  leadingContent: React.ReactNode;
  trailingContent?: React.ReactNode;
  onNavigateBack?: () => void;
  disableBackButton?: boolean;
  width?: "contained" | "full";
  className?: string;
}) => {
  const { o } = useSearch({ strict: false });
  const navigateBack = useNavigateBack();

  return (
    <PageHeader width={width} className={className}>
      <FadeIn className="flex min-w-0 flex-1 items-center gap-4">
        {o && (
          <Button
            onClick={onNavigateBack ? onNavigateBack : navigateBack}
            variant="ghost"
            className="h-8 px-2 lg:px-3 "
            disabled={disableBackButton}
          >
            <ArrowLeftIcon className="h-4 w-4" />
          </Button>
        )}
        {leadingContent}
      </FadeIn>

      {trailingContent}
    </PageHeader>
  );
};

export default PageHeader;
