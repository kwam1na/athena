import { Badge } from './badge';

const InStockBadge = () => {
   return <Badge variant="success">In Stock</Badge>;
};

const InStockIndicator = () => {
   return (
      <div className="flex space-x-2 items-center">
         <span className="w-[8px] h-[8px] rounded-full bg-success" />
         <p className="text-sm">In stock</p>
      </div>
   );
};

const LowStockBadge = () => {
   return <Badge variant="warning">Low in stock</Badge>;
};

const LowStockIndicator = () => {
   return (
      <div className="flex space-x-2 items-center">
         <span className="w-[8px] h-[8px] rounded-full bg-warning" />
         <p className="text-sm">Low in stock</p>
      </div>
   );
};

const SoldOutBadge = () => {
   return <Badge variant="destructive">Sold out</Badge>;
};

const SoldOutIndicator = () => {
   return (
      <div className="flex space-x-2 items-center">
         <span className="w-[8px] h-[8px] rounded-full bg-destructive" />
         <p className="text-sm">Sold out</p>
      </div>
   );
};

export {
   InStockBadge,
   InStockIndicator,
   LowStockBadge,
   LowStockIndicator,
   SoldOutBadge,
   SoldOutIndicator,
};
