import { CheckCircledIcon, DotsHorizontalIcon } from "@radix-ui/react-icons";
import { Row } from "@tanstack/react-table";

import { Button } from "../../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";

import { useNavigate } from "@tanstack/react-router";
import { deleteProduct } from "@/api/product";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban } from "lucide-react";
import { useState } from "react";
import { AlertModal } from "@/components/ui/modals/alert-modal";
import { ProductResponseBody } from "@/lib/schemas/product";
// import { Product } from "@athena/db";
import { useDeleteProduct } from "../../product-actions";
import { Product } from "~/types";

interface DataTableRowActionsProps<TData> {
  row: Row<TData>;
}

export function DataTableRowActions<TData>({
  row,
}: DataTableRowActionsProps<TData>) {
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleteMutationPending, setIsDeleteMutationPending] = useState(false);

  const queryClient = useQueryClient();

  const navigate = useNavigate();

  const product = row.original as Product;

  const deleteRowItem = useDeleteProduct(product._id);

  const deleteItem = async () => {
    try {
      setIsDeleteMutationPending(true);
      await deleteRowItem();

      toast(`Product '${product.name}' deleted`, {
        icon: <CheckCircledIcon className="w-4 h-4" />,
      });

      navigate({
        to: "/$orgUrlSlug/store/$storeUrlSlug/products",
        params: (prev) => ({
          ...prev,
          orgUrlSlug: prev.orgUrlSlug!,
          storeUrlSlug: prev.storeUrlSlug!,
        }),
      });
    } catch (e) {
      toast("Something went wrong", {
        icon: <Ban className="w-4 h-4" />,
        description: (e as Error).message,
      });
    } finally {
      setIsDeleteMutationPending(false);
      setIsDeleteModalOpen(false);
    }
  };

  // const deleteMutation = useMutation({
  //   mutationFn: deleteItem,
  //   onSuccess: () => {
  //     toast(`Product '${product.name}' deleted`, {
  //       icon: <CheckCircledIcon className="w-4 h-4" />,
  //     });

  //     navigate({
  //       to: "/$orgUrlSlug/store/$storeUrlSlug/products",
  //       params: (prev) => ({
  //         ...prev,
  //         orgUrlSlug: prev.orgUrlSlug!,
  //         storeUrlSlug: prev.storeUrlSlug!,
  //       }),
  //     });

  //     setIsDeleteModalOpen(false);
  //   },
  //   onError: () => {
  //     toast("Something went wrong", { icon: <Ban className="w-4 h-4" /> });
  //   },
  // });

  return (
    <>
      <AlertModal
        title="Delete product?"
        isOpen={isDeleteModalOpen}
        loading={isDeleteMutationPending}
        onClose={() => {
          setIsDeleteModalOpen(false);
        }}
        onConfirm={() => {
          deleteItem();
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="flex h-8 w-8 p-0 data-[state=open]:bg-muted"
          >
            <DotsHorizontalIcon className="h-4 w-4" />
            <span className="sr-only">Open menu</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[160px]">
          <DropdownMenuItem
            onClick={() =>
              navigate({
                to: "/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug",
                params: (prev) => ({
                  ...prev,
                  orgUrlSlug: prev.orgUrlSlug!,
                  storeUrlSlug: prev.storeUrlSlug!,
                  productSlug: product.slug,
                }),
              })
            }
          >
            Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setIsDeleteModalOpen(true)}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
