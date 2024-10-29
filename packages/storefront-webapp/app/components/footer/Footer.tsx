import { useStoreContext } from "@/contexts/StoreContext";
import { Link } from "@tanstack/react-router";
import { ShoppingBasket } from "lucide-react";
import { Badge } from "../ui/badge";
import { useShoppingBag } from "@/hooks/useShoppingBag";

export default function Footer() {
  const { store } = useStoreContext();

  return (
    <footer className="w-full h-[96px] flex flex-shrink-0 gap-8 items-center justify-center bg-zinc-100 p-2 ">
      <div className="flex items-center justify-center w-full">
        <p>
          © {new Date().getFullYear()} {store?.name}. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
