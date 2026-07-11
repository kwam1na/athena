import View from "@/components/View";
import NotFound from "./NotFound";

export function NotFoundView({
  entity,
  entityIdentifier,
  homePath,
}: {
  entity: string;
  entityIdentifier: string;
  homePath?: "/" | "/app";
}) {
  return (
    <View>
      <NotFound
        entity={entity}
        entityIdentifier={entityIdentifier}
        homePath={homePath}
      />
    </View>
  );
}
