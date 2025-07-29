import { ProductSku } from "@athena/webapp";
import { Check, CheckCheck, Dumbbell, Factory, Gem, Ruler } from "lucide-react";

export const AboutProduct = ({
  productSku,
  productAttributes,
}: {
  productSku: ProductSku;
  productAttributes: Record<string, any>;
}) => {
  const { wigMake, wigTexture } = productAttributes || {};

  return (
    <div className="space-y-4">
      <p className="text-sm">Details</p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
        {productSku.size && (
          <div className="flex items-center gap-2">
            <Ruler className="w-3.5 h-3.5 text-gray-700" />
            <p className="text-sm">{productSku.size || "-"} lace</p>
          </div>
        )}

        {productSku.weight && (
          <div className="flex items-center gap-2">
            <Dumbbell className="w-3.5 h-3.5 text-gray-700" />
            <p className="text-sm">{productSku.weight || "-"}</p>
          </div>
        )}

        {wigMake == "custom" && (
          <div className="flex items-center gap-2">
            <Gem className="w-3.5 h-3.5 text-gray-700" />
            <p className="text-sm">Custom made</p>
          </div>
        )}

        {wigMake == "factory-made" && (
          <div className="flex items-center gap-2">
            <Factory className="w-3.5 h-3.5 text-gray-700" />
            <p className="text-sm">Factory-made</p>
          </div>
        )}

        {wigTexture == "single-drawn" && (
          <div className="flex items-center gap-2">
            <Check className="w-3.5 h-3.5 text-gray-700" />
            <p className="text-sm">Single-drawn</p>
          </div>
        )}

        {wigTexture == "double-drawn" && (
          <div className="flex items-center gap-2">
            <CheckCheck className="w-3.5 h-3.5 text-gray-700" />
            <p className="text-sm">Double-drawn</p>
          </div>
        )}
      </div>
    </div>
  );
};
