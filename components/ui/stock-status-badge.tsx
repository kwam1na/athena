import { Badge } from './badge';

const InStockBadge = () => {
   return <Badge variant="success">In Stock</Badge>;
};

const LowStockBadge = () => {
   return <Badge variant="warning">Low in stock</Badge>;
};

const SoldOutBadge = () => {
   return <Badge variant="destructive">Sold out</Badge>;
};

export { InStockBadge, LowStockBadge, SoldOutBadge };
