import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

interface ErrorPageProps {
  title: string;
  subtitle?: string;
}

export const ErrorPage: React.FC<ErrorPageProps> = ({ title, subtitle }) => {
  return (
    <div className="flex justify-center items-center h-full">
      <div>
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <AlertCircle className="h-5 w-5 mt-1 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">{title}</CardTitle>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
};

export { ErrorBoundary } from "./ErrorBoundary";
