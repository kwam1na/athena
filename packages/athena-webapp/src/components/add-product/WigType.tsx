import { Label } from "../ui/label";
import View from "../View";
import { Switch } from "../ui/switch";
import { useState } from "react";
import { useProduct } from "~/src/contexts/ProductContext";

export function WigTypeView() {
  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="h-auto"
      header={<p className="text-sm text-sm text-muted-foreground">Wig make</p>}
    >
      <WigType />
    </View>
  );
}

function WigType() {
  const { productData, updateProductData } = useProduct();

  const handleToggle = (id: string) => {
    console.log(id);
    updateProductData({
      attributes: { ...productData.attributes, wigMake: id },
    });
  };

  return (
    <div className="flex">
      <div className="flex flex-col gap-4 pt-8 py-4 pl-8">
        <div className="flex items-center gap-2">
          <Switch
            id="custom"
            checked={productData.attributes?.wigMake === "custom"}
            onCheckedChange={() => {
              updateProductData({
                attributes: { ...productData.attributes, wigMake: "custom" },
              });
            }}
          />
          <Label className="text-muted-foreground" htmlFor="custom">
            Custom
          </Label>
        </div>

        <div className="flex items-center gap-2">
          <Switch
            id="factory-made"
            checked={productData.attributes?.wigMake === "factory-made"}
            onCheckedChange={() => {
              updateProductData({
                attributes: {
                  ...productData.attributes,
                  wigMake: "factory-made",
                },
              });
            }}
          />
          <Label className="text-muted-foreground" htmlFor="factory-made">
            Factory made
          </Label>
        </div>
      </div>

      <div className="flex flex-col gap-4 pt-8 py-4 pl-8">
        <div className="flex items-center gap-2">
          <Switch
            id="single-drawn"
            checked={productData.attributes?.wigTexture === "single-drawn"}
            onCheckedChange={() => {
              updateProductData({
                attributes: {
                  ...productData.attributes,
                  wigTexture: "single-drawn",
                },
              });
            }}
          />
          <Label className="text-muted-foreground" htmlFor="single-drawn">
            Single-drawn
          </Label>
        </div>

        <div className="flex items-center gap-2">
          <Switch
            id="double-drawn"
            checked={productData.attributes?.wigTexture === "double-drawn"}
            onCheckedChange={() => {
              updateProductData({
                attributes: {
                  ...productData.attributes,
                  wigTexture: "double-drawn",
                },
              });
            }}
          />
          <Label className="text-muted-foreground" htmlFor="double-drawn">
            Double-drawn
          </Label>
        </div>
      </div>
    </div>
  );
}
