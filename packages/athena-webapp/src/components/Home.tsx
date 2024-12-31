import View from "./View";

import { BestSellers } from "./homepage/BestSellers";
import { FeaturedSection } from "./homepage/FeaturedSection";

export default function Home() {
  const Navigation = () => {
    return (
      <div className="flex gap-2 h-[40px]">
        <p className="text-sm">Homepage</p>
      </div>
    );
  };

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="bg-background"
      header={<Navigation />}
    >
      <div className="grid grid-cols-2 gap-4">
        <BestSellers />
        <FeaturedSection />
      </div>
    </View>
  );
}
