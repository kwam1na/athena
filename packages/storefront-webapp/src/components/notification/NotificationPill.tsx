export const NotificationPill = ({ message }: { message: string }) => {
  return (
    <div className="w-fit h-[40px] px-4 border border-accent2/10 bg-white rounded-full shadow-sm flex items-center gap-2">
      <p className="text-xs">{message}</p>
    </div>
  );
};
