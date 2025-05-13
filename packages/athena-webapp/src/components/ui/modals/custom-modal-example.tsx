import React, { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CustomModal } from "./custom-modal";

// Example 1: Basic usage with header, body, and footer
export const BasicModalExample = () => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setIsOpen(true)}>Open Basic Modal</Button>

      <CustomModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        header={<h2 className="text-xl font-semibold">Welcome Back</h2>}
        body={
          <div>
            <p className="text-gray-500">
              Take 10% off your first order, just for stopping by again.
            </p>
            <input
              type="email"
              placeholder="Email address"
              className="w-full mt-4 p-3 border rounded-md"
            />
          </div>
        }
        footer={
          <div className="flex justify-between w-full">
            <Button variant="outline" onClick={() => setIsOpen(false)}>
              No thanks
            </Button>
            <Button onClick={() => setIsOpen(false)}>Send My Code</Button>
          </div>
        }
      />
    </>
  );
};

// Example 2: Custom positioning and size
export const CustomPositionModalExample = () => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setIsOpen(true)}>Open Top Modal</Button>

      <CustomModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        position="top"
        size="sm"
        body={
          <div className="text-center">
            <p>
              This modal appears at the top of the screen with a small width.
            </p>
          </div>
        }
      />
    </>
  );
};

// Example 3: Custom close button
export const CustomCloseButtonExample = () => {
  const [isOpen, setIsOpen] = useState(false);

  const customCloseButton = (
    <button
      onClick={() => setIsOpen(false)}
      className="absolute right-4 top-4 rounded-full p-2 bg-gray-100 hover:bg-gray-200"
    >
      <X className="h-4 w-4" />
    </button>
  );

  return (
    <>
      <Button onClick={() => setIsOpen(true)}>Modal with Custom Close</Button>

      <CustomModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        closeButton={customCloseButton}
        body={
          <div className="py-8">
            <h3 className="text-lg font-medium">Custom Close Button Example</h3>
            <p className="mt-2">
              This modal has a custom close button in the top-right corner.
            </p>
          </div>
        }
      />
    </>
  );
};

// Example 4: Full screen modal
export const FullScreenModalExample = () => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setIsOpen(true)}>Open Full Screen Modal</Button>

      <CustomModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        size="full"
        contentClassName="h-screen sm:rounded-none p-0"
        body={
          <div className="flex flex-col h-full">
            <div className="flex justify-between items-center p-4 border-b">
              <h2 className="text-xl font-bold">Full Screen Modal</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsOpen(false)}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="flex-1 p-6 overflow-auto">
              <p>This is a full screen modal with custom content layout.</p>
              <div className="mt-8">
                <p>
                  You can add any content here and it will scroll if needed.
                </p>
                {Array(20)
                  .fill(0)
                  .map((_, i) => (
                    <p key={i} className="my-4">
                      Content row {i + 1}
                    </p>
                  ))}
              </div>
            </div>
            <div className="p-4 border-t">
              <Button className="w-full" onClick={() => setIsOpen(false)}>
                Close Modal
              </Button>
            </div>
          </div>
        }
        hideCloseButton={true}
      />
    </>
  );
};
