import React, { useEffect, useRef, useState } from "react";
import { ScrollArea } from "../ui/scroll-area";

interface GalleryViewerProps {
  images: string[];
}

const GalleryViewer: React.FC<GalleryViewerProps> = ({ images }) => {
  const [activeImage, setActiveImage] = useState(0);
  const imageRefs = useRef<HTMLImageElement[] | null[]>([]);
  const [didClickOnPreview, setDidClickOnPreview] = useState(false);

  const scroller = useRef<HTMLDivElement | null>(null);

  // Setup Intersection Observer
  useEffect(() => {
    if (didClickOnPreview) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const index = imageRefs.current.findIndex(
              (img) => img === entry.target
            );
            setActiveImage(index);
          }
        });
      },
      {
        threshold: 0.5,
      }
    );

    imageRefs.current.forEach((img) => {
      if (img) observer.observe(img);
    });

    return () => {
      observer.disconnect();
    };
  }, [imageRefs.current, didClickOnPreview]);

  const handleClickOnPreview = (index: number) => {
    setDidClickOnPreview(true);

    const selectedImage = imageRefs.current[index];
    if (selectedImage && scroller.current) {
      const offset = selectedImage.offsetTop - scroller.current.offsetTop;

      scroller.current.scrollTo({
        top: offset,
        behavior: "smooth",
      });
    }

    setActiveImage(index);

    setTimeout(() => {
      setDidClickOnPreview(false);
    }, 500);
  };

  return (
    <div className="w-full flex flex-row items-center gap-8">
      <ScrollArea
        ref={scroller}
        className="snap-mandatory snap-y w-full h-[600px] lg:w-[800px] lg:h-[800px]"
      >
        {images.map((img, index) => (
          <div className="snap-center" key={index}>
            <img
              ref={(el) => (imageRefs.current[index] = el)}
              alt={`image`}
              className={`aspect-square w-full h-[600px] lg:w-[800px] lg:h-[800px] lg:rounded-md object-cover cursor-pointer`}
              src={img}
            />
          </div>
        ))}
      </ScrollArea>

      {/* Preview Panel */}
      <div className="hidden lg:flex lg:flex-col lg:mt-auto">
        {images.map((img, index) => (
          <div
            key={index}
            className={`cursor-pointer`}
            onClick={() => handleClickOnPreview(index)}
          >
            <img
              src={img}
              alt={`Preview ${index}`}
              className={`aspect-square w-16 h-16 object-cover rounded-md ${activeImage == index ? "opacity-100" : "opacity-20"}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default GalleryViewer;
