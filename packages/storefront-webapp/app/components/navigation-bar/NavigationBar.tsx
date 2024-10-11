import { useStoreContext } from "@/contexts/StoreContext";
import { Link } from "@tanstack/react-router";
import { ShoppingBasket } from "lucide-react";
import { Badge } from "../ui/badge";
import { useShoppingBag } from "@/hooks/useShoppingBag";

export default function NavigationBar() {
  const { store } = useStoreContext();
  const { bagCount } = useShoppingBag();

  return (
    <nav className="w-full h-[48px] flex flex-shrink-0 gap-8 items-center justify-center bg-zinc-100 p-2 ">
      <div className="flex items-center justify-between w-[60%]">
        <div className="flex items-center gap-8">
          <div>
            <Link to="/">
              <h1 className="text-xl font-medium">{store?.name}</h1>
            </Link>
          </div>

          <div className="flex gap-8">
            {/* <Link to="/">
              <p className="">Shop</p>
            </Link> */}
            {/* {store?.categories.map((category) => (
              <Link
                key={category.id}
                to="/$categorySlug"
                params={(prev) => ({
                  ...prev,
                  categorySlug: category.slug,
                })}
              >
                <p className="">{category.name}</p>
              </Link>
            ))} */}
          </div>
        </div>

        <Link to="/shop/bag" className="flex gap-2">
          <ShoppingBasket className="w-5 h-5" />
          {bagCount > 0 && <Badge>{bagCount}</Badge>}
          {/* <div > */}
          {/* </div> */}
        </Link>
      </div>
    </nav>
  );
}
