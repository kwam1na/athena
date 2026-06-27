import View from "../View";
import { Header } from "./components/Header";
import { FeesView } from "./components/FeesView";
import { ContactView } from "./components/ContactView";
import { TaxView } from "./components/TaxView";
import { MaintenanceView } from "./components/MaintenanceView";
import { FulfillmentView } from "./components/FulfillmentView";
import { MtnMomoView } from "./components/MtnMomoView";
import { StoreHoursView } from "./components/StoreHoursView";

export const StoreConfiguration = () => {
  return (
    <View hideBorder hideHeaderBottomBorder header={<Header />}>
      <div className="container mx-auto h-full w-full py-8">
        <StoreHoursView />

        <div className="grid grid-cols-1 gap-8 pt-8 lg:grid-cols-2 lg:gap-40">
          <FeesView />
          <ContactView />
          <MtnMomoView />

          <TaxView />
          <MaintenanceView />

          <FulfillmentView />
        </div>
      </div>
    </View>
  );
};
