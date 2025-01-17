const PageHeader = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="container mx-auto py-6 px-4 flex gap-2 h-[40px] items-center justify-between">
      {children}
    </div>
  );
};

export default PageHeader;
