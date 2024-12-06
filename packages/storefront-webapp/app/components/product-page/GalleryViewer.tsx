import React, { useState } from "react";
import { ScrollArea } from "../ui/scroll-area";

interface GalleryViewerProps {
  images: string[];
}

const GalleryViewer: React.FC<GalleryViewerProps> = ({ images }) => {
  const [activeIndex, setActiveIndex] = useState(0);

  return (
    <div className="w-full flex flex-row items-center gap-8">
      {/* Main Gallery */}

      {/* Preview Panel */}
      <ScrollArea className="w-[800px] h-[800px] overflow-auto">
        <div className="flex flex-col gap-16">
          {images.map((img, index) => (
            <img
              key={index}
              alt={`image`}
              className={`aspect-square w-[800px] h-[800px] object-cover cursor-pointer`}
              src={img}
            />
          ))}
        </div>
      </ScrollArea>

      <div className="mt-auto">
        {images.map((img, index) => (
          <div
            key={index}
            className={`cursor-pointer`}
            onClick={() => setActiveIndex(index)}
          >
            <img
              src={img}
              alt={`Preview ${index}`}
              className="aspect-square w-16 h-16 object-cover opacity-20"
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default GalleryViewer;
