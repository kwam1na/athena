import { GetServerSideProps } from "next";
import { useItemStore } from "@/stores/items";
import * as React from "react";
import { Item } from "@/lib/types";
import axiosInstance from "@/lib/axios";

type ItemsProps = {
  initialItems: Item[];
};

export default function Items({ initialItems }: ItemsProps) {
  const setItems = useItemStore((state) => state.setItems);
  const items = useItemStore((state) => state.items);

  React.useEffect(() => {
    setItems(initialItems);
  }, [initialItems, setItems]);

  return (
    <div>
      {items.map((item) => (
        <div key={item.id}>
          <p>
            {item.name} - {item.color} - {item.created_at}
          </p>
        </div>
      ))}
    </div>
  );
}

export const getServerSideProps: GetServerSideProps<ItemsProps> = async () => {
  const res = await axiosInstance.get("/items");
  const initialItems: Item[] = await res.data;

  return {
    props: {
      initialItems,
    },
  };
};
