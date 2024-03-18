export const InfoLine = ({
   text,
   isBold,
   isMuted,
   icon,
}: {
   text?: string;
   isBold?: boolean;
   isMuted?: boolean;
   icon?: React.ReactNode;
}) => {
   return (
      <div className="flex items-center gap-2">
         {icon}
         <p
            className={`text-sm ${isBold ? 'font-semibold' : ''} ${
               isMuted ? 'text-muted-foreground' : ''
            }`}
         >
            {text}
         </p>
      </div>
   );
};
