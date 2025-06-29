import NavigationBar from "@/components/navigation-bar/NavigationBar";

export const MaintenanceMode = () => {
  return (
    <div className="container mx-auto px-4 lg:px-0 overflow-hidden">
      <div className="flex flex-col items-center justify-center h-screen">
        <div className="space-y-12">
          <h1 className="text-3xl text-accent2 font-light uppercase flex items-center justify-center w-full tracking-widest py-4">
            Wigclub
          </h1>
          <div className="space-y-4">
            <p className="text-lg text-center font-medium">
              We're updating our store...
            </p>
            <p className="text-muted-foreground text-center">
              We're working on bringing you amazing products. Check back soon!
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
