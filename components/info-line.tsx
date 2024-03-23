export const InfoLine = ({
   text,
   isBold,
   isMuted,
   icon,
   className,
}: {
   text?: string;
   isBold?: boolean;
   isMuted?: boolean;
   icon?: React.ReactNode;
   className?: string;
}) => {
   return (
      <div className={`flex items-center gap-2 ${className}`}>
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
