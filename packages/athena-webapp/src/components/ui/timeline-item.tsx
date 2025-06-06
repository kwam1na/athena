import { Circle } from "lucide-react";

export function TimelineItem({
  item,
  subtitle,
}: {
  item: React.ReactNode;
  subtitle: React.ReactNode;
}) {
  return (
    <div className="flex items-center">
      <div className="space-y-2">
        <div className="flex items-center">
          <Circle className="h-2 w-2 mt-1 mr-2 text-muted-foreground" />
          {item}
        </div>
        {subtitle}
      </div>
    </div>
  );
}
