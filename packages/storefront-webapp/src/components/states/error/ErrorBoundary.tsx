import { useRouter, ErrorComponentProps } from "@tanstack/react-router";
import { AlertCircle, Home, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function ErrorBoundary({ error, reset }: ErrorComponentProps) {
  const router = useRouter();

  const handleReset = () => {
    reset();
  };

  const handleGoHome = () => {
    router.navigate({ to: "/" });
  };

  // Extract a user-friendly error message
  const getErrorMessage = () => {
    if (error instanceof Error) {
      // Check for specific error types and provide friendlier messages
      if (error.message.includes("useStoreContext")) {
        return "We're currently affected by an AWS outage that's impacting parts of the site. Our team has applied all available mitigations and is waiting on AWS to restore service — please try again or check the status page for updates";
      }
      if (error.message.includes("Network")) {
        return "We're having trouble connecting. Please check your internet connection and try again.";
      }
      return error.message;
    }
    return "An unexpected error occurred. Please try again.";
  };

  const errorMessage = getErrorMessage();
  const isDevelopment = import.meta.env.DEV;

  return (
    <div className="container mx-auto min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-md space-y-12">
        <div className="space-y-8 px-8">
          <div className="flex items-center gap-2">
            <CardTitle className="text-2xl">
              Service temporarily unavailable
            </CardTitle>
          </div>
          <p className="text-base">
            We're affected by an outage with our cloud provider that's impacting
            parts of the site.
          </p>

          <p className="text-base">
            We've applied all available mitigations and are awaiting a fix on
            their end. Please try again later.
          </p>
        </div>

        {/* <CardContent className="space-y-4">
          {isDevelopment && error instanceof Error && (
            <div className="rounded-lg bg-muted p-4 space-y-2">
              <p className="text-xs font-mono font-semibold text-muted-foreground">
                Development Error Details:
              </p>
              <pre className="text-xs font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap break-words">
                {error.stack || error.message}
              </pre>
            </div>
          )}

          <div className="text-sm text-muted-foreground">
            <p>You can try:</p>
            <ul className="list-disc list-inside mt-2 space-y-1 ml-2">
              <li>Refreshing the page</li>
              <li>Going back to the home page</li>
            </ul>
          </div>
        </CardContent> */}

        <CardFooter className="flex gap-2">
          <Button onClick={handleReset} variant="default" size="default">
            {/* <RefreshCw className="mr-2 h-4 w-4" /> */}
            Try Again
          </Button>
          {/* <Button
            onClick={handleGoHome}
            variant="outline"
            className="flex-1"
            size="default"
          >
            Go Home
          </Button> */}
        </CardFooter>
      </div>
    </div>
  );
}
