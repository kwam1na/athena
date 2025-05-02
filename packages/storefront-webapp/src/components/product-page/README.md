# Product Page Components

This directory contains the components for the product page of the storefront.

## Architecture

The product page is built with a responsive design approach, using a single `ProductPage` component that renders different layouts for mobile and desktop viewports.

### Key Components

- **ProductPage.tsx**: Main component that orchestrates the product page experience
- **ProductInfo.tsx**: Displays product name, price, and inventory badges
- **ProductActions.tsx**: Handles "Add to Bag" and "Save" functionality
- **GalleryViewer.tsx**: Original image gallery with scroll area and thumbnail navigation
- **ProductAttribute.tsx**: Displays and manages product attributes/variants
- **ProductDetails.tsx**: Contains shipping/pickup info and related components

### Hooks and Utilities

- **useProductPageLogic.ts**: Custom hook that centralizes product page state and logic
- **productUtils.ts**: Utility functions for product-related operations

## Responsive Design

The product page uses a responsive design approach:

- For mobile: Uses a single-column stacked layout with a scrollable image gallery at the top
- For desktop: Uses a two-column grid layout with product details on the right

## Best Practices

This implementation follows these best practices:

1. **Separation of concerns**: Logic extracted to hooks, UI in components
2. **Reusable components**: Components are modular and reusable
3. **Responsive design**: Single component with different layouts based on viewport
4. **DRY principle**: Common logic and styles are shared
5. **Performance optimizations**: Memoization and proper dependency tracking
