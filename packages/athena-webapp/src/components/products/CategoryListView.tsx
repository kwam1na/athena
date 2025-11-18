import { useSearch } from "@tanstack/react-router";
import View from "../View";
import { FadeIn } from "../common/FadeIn";
import Products from "./Products";
import { useNavigateBack } from "~/src/hooks/use-navigate-back";

import { Button } from "../ui/button";
import { ArrowLeftIcon } from "@radix-ui/react-icons";
import { cn } from "~/src/lib/utils";

const Navigation = () => {
  const navigateBack = useNavigateBack();
  const { o } = useSearch({ strict: false });

  return (
    <div className="container mx-auto flex gap-2">
      <div className="flex items-center gap-2">
        {o && (
          <Button variant="ghost" onClick={navigateBack}>
            <ArrowLeftIcon className="w-4 h-4" />
          </Button>
        )}
        <p className={cn("font-medium text-xl capitalize", o && "text-md")}>
          Products
        </p>
      </div>
    </div>
  );
};

export default function CategoryListView() {
  return (
    <View hideBorder hideHeaderBottomBorder header={<Navigation />}>
      <FadeIn className="py-16">
        <Products />
      </FadeIn>
    </View>
  );
}
