import { ProductSku } from "@athena/webapp";
import { CheckIcon } from "@radix-ui/react-icons";

export const About = ({
  productSku,
  productAttributes,
}: {
  productSku: ProductSku;
  productAttributes: Record<string, any>;
}) => {
  const { wigMake, wigTexture } = productAttributes || {};
  return (
    <table className="min-w-full border-separate border-spacing-0 rounded-lg overflow-hidden border">
      <thead className="text-sm md:table-header-group hidden">
        <tr>
          <th className="border font-medium px-4 py-2">Size</th>
          <th className="border font-medium px-4 py-2">Weight</th>
          <th className="border font-medium px-4 py-2">Custom</th>
          <th className="border font-medium px-4 py-2">Factory-made</th>
          <th className="border font-medium px-4 py-2">Single-drawn</th>
          <th className="border font-medium px-4 py-2">Double-drawn</th>
        </tr>
      </thead>

      <tbody className="block md:table-row-group">
        <tr className="grid grid-cols-2 md:table-row">
          <td className="border px-4 py-2">
            {/* Size */}
            <span className="md:hidden text-sm font-medium mr-2">Size:</span>
            {productSku.size || "-"}
          </td>
          <td className="border px-4 py-2">
            {/* Weight */}
            <span className="md:hidden text-sm font-medium mr-2">Weight:</span>
            {productSku.weight || "-"}
          </td>
          <td className="border px-4 py-2">
            {/* Custom */}
            <span className="md:hidden text-sm font-medium mr-2">Custom:</span>
            {wigMake == "custom" && <CheckIcon className="w-4 h-4" />}
          </td>
          <td className="border px-4 py-2">
            {/* Factory-made */}
            <span className="md:hidden text-sm font-medium mr-2">
              Factory-made:
            </span>
            {wigMake == "factory-made" && <CheckIcon className="w-4 h-4" />}
          </td>
          <td className="border px-4 py-2">
            {/* Single-drawn */}
            <span className="md:hidden text-sm font-medium mr-2">
              Single-drawn:
            </span>
            {wigTexture == "single-drawn" && <CheckIcon className="w-4 h-4" />}
          </td>
          <td className="border px-4 py-2">
            {/* Double-drawn */}
            <span className="md:hidden text-sm font-medium mr-2">
              Double-drawn:
            </span>
            {wigTexture == "double-drawn" && <CheckIcon className="w-4 h-4" />}
          </td>
        </tr>
      </tbody>
    </table>
  );
};
