import View from "../View";
import { Header } from "./components/Header";
import { FeesView } from "./components/FeesView";
import { ContactView } from "./components/ContactView";
import { TaxView } from "./components/TaxView";
import { MaintenanceView } from "./components/MaintenanceView";
import { FulfillmentView } from "./components/FulfillmentView";

export const StoreConfiguration = () => {
  return (
    <View hideBorder hideHeaderBottomBorder header={<Header />}>
      <div className="container mx-auto h-full w-full py-8 grid grid-cols-2 gap-40">
        <FeesView />
        <ContactView />

        <TaxView />
        <MaintenanceView />

        <FulfillmentView />
      </div>
    </View>
  );
};
