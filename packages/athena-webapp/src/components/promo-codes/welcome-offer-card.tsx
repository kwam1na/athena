import React from "react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Eye, MoreVertical, Pencil, Trash, ToggleRight } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

export interface WelcomeOfferCardProps {
  id: string;
  name: string;
  heading: string;
  discountPercent: number;
  isActive: boolean;
  requiresEmail: boolean;
  imageUrl?: string;
  backgroundColor: string;
  lastUpdated: Date;
  promoCodeName?: string;
  onEdit: (id: string) => void;
  onPreview: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleActive: (id: string, active: boolean) => void;
}

export const WelcomeOfferCard: React.FC<WelcomeOfferCardProps> = ({
  id,
  name,
  heading,
  discountPercent,
  isActive,
  requiresEmail,
  imageUrl,
  backgroundColor,
  lastUpdated,
  promoCodeName,
  onEdit,
  onPreview,
  onDelete,
  onToggleActive,
}) => {
  return (
    <Card className="overflow-hidden">
      {/* Preview Section */}
      <div
        className="h-40 relative flex items-center justify-center p-4"
        style={{
          backgroundColor: backgroundColor || "rgba(0, 0, 0, 0.5)",
          backgroundImage: imageUrl ? `url(${imageUrl})` : "none",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        {/* Overlay for better text readability */}
        <div className="absolute inset-0 bg-black bg-opacity-40" />

        {/* Status Badge */}
        <div className="absolute top-2 right-2 z-10">
          <Badge variant={isActive ? "default" : "outline"}>
            {isActive ? "Active" : "Inactive"}
          </Badge>
        </div>

        {/* Preview content */}
        <div className="relative z-10 text-white text-center">
          <h3 className="text-lg font-semibold truncate max-w-[90%] mx-auto">
            {heading}
          </h3>
          <p className="text-sm mt-1">{discountPercent}% discount</p>
        </div>
      </div>

      <CardContent className="p-4 border-t">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="font-medium truncate max-w-[200px]">{name}</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Updated {lastUpdated.toLocaleDateString()}
            </p>
            {promoCodeName && (
              <p className="text-xs mt-2">
                Code: <span className="font-medium">{promoCodeName}</span>
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Switch
              checked={isActive}
              onCheckedChange={(checked) => onToggleActive(id, checked)}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onEdit(id)}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onPreview(id)}>
                  <Eye className="h-4 w-4 mr-2" />
                  Preview
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-red-600"
                  onClick={() => onDelete(id)}
                >
                  <Trash className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardContent>

      <CardFooter className="p-4 pt-0 flex justify-between items-center">
        <div className="flex gap-2">
          {requiresEmail && (
            <Badge variant="outline" className="text-xs">
              Email Required
            </Badge>
          )}
        </div>

        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => onPreview(id)}
        >
          <Eye className="h-4 w-4 mr-2" />
          Preview
        </Button>
      </CardFooter>
    </Card>
  );
};
