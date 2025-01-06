import View from "./View";

import { BestSellers } from "./homepage/BestSellers";
import { FeaturedSection } from "./homepage/FeaturedSection";

export default function Home() {
  const Navigation = () => {
    return (
      <div className="container mx-auto flex gap-2 h-[40px]">
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
      <div className="container mx-auto grid grid-cols-2 gap-40">
        <BestSellers />
        <FeaturedSection />
      </div>
    </View>
  );
}
