import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { PageState } from "../PageState";

export default function NotFound() {
  return (
    <PageState
      state="terminal"
      title="Page not found"
      description="The page you're looking for does not exist."
      primaryAction={
          <Button
            onClick={() => window.history.back()}
          >
            Take me back
          </Button>
      }
      secondaryAction={
          <Link to="/">
            <Button variant="outline">
              Go to home page
            </Button>
          </Link>
      }
    />
  );
}
