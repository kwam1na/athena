import View from "../../View";
import { Button } from "../../ui/button";
import { EmptyState } from "../empty/empty-state";

type ProtectedAdminSignInViewProps = {
  description: string;
};

export function ProtectedAdminSignInView({
  description,
}: ProtectedAdminSignInViewProps) {
  return (
    <View>
      <div className="container mx-auto py-8">
        <EmptyState
          cta={
            <Button asChild className="mt-4" variant="outline">
              <a href="/login">Sign in again</a>
            </Button>
          }
          description={description}
          title="Sign in required"
        />
      </div>
    </View>
  );
}
