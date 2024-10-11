import View from "@/components/View";
import NotFound from "./NotFound";

export function NotFoundView({
  entity,
  entityIdentifier,
}: {
  entity: string;
  entityIdentifier: string;
}) {
  return (
    <View>
      <NotFound entity={entity} entityIdentifier={entityIdentifier} />
    </View>
  );
}
