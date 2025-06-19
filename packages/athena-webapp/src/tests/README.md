# POS System Test Suite

This directory contains comprehensive tests for the Point of Sale (POS) system, covering all aspects from individual components to complete transaction flows.

## Test Structure

### 📁 Test Files

- **`usePOSOperations.test.ts`** - Core business logic and state management
- **`backend.test.ts`** - Backend functions and inventory validation
- **`usePrint.test.ts`** - Receipt printing functionality
- **`integration.test.ts`** - End-to-end transaction flows
- **`components.test.tsx`** - UI component interactions
- **`posStore.test.ts`** - Store state management (if needed)

## Test Coverage Areas

### 🛒 Cart Management

- ✅ Adding products to cart
- ✅ Updating item quantities
- ✅ Removing items from cart
- ✅ Cart total calculations
- ✅ Handling duplicate products
- ✅ Cart clearing functionality

### 👤 Customer Management

- ✅ Customer information updates
- ✅ Customer search functionality
- ✅ Customer selection and deselection
- ✅ New customer creation
- ✅ Customer data validation

### 💳 Transaction Processing

- ✅ Direct transaction completion
- ✅ Session-based transactions
- ✅ Payment method selection
- ✅ Transaction validation
- ✅ Error handling and rollback
- ✅ POS transaction number generation

### 📦 Inventory Validation

- ✅ Single item inventory checks
- ✅ Multiple item validation
- ✅ Cumulative quantity validation (fixed bug)
- ✅ Insufficient inventory handling
- ✅ Missing product SKU handling

### 🖨️ Receipt Printing

- ✅ Receipt HTML generation
- ✅ Print window management
- ✅ Currency formatting
- ✅ Customer information display
- ✅ Error handling for blocked popups
- ✅ Window close prevention (fixed bug)

### 🎯 UI Components

- ✅ OrderSummary component
- ✅ CustomerInfoPanel component
- ✅ ProductEntry component
- ✅ CartItems component
- ✅ User interactions and form handling

### 🔄 Integration Flows

- ✅ Complete transaction workflow
- ✅ Barcode scanning integration
- ✅ Session management
- ✅ Error recovery scenarios

## Key Test Scenarios

### Critical Business Logic Tests

1. **Multi-Item Inventory Validation**

   ```typescript
   // Tests the fix for the inventory validation bug
   // where multiple items of the same product could exceed available inventory
   ```

2. **Transaction Completion Flow**

   ```typescript
   // Tests complete flow from cart → customer → payment → receipt
   ```

3. **Error Handling**

   ```typescript
   // Tests graceful handling of API failures, network errors, and validation failures
   ```

4. **Print Window Management**
   ```typescript
   // Tests the fix for print window reopening bug
   ```

## Mock Strategy

### Convex API Mocking

```typescript
vi.mock("convex/react", () => ({
  useMutation: vi.fn((mutation) => {
    // Returns appropriate mock based on mutation type
  }),
  useQuery: vi.fn(() => null),
  useAction: vi.fn(() => vi.fn()),
}));
```

### Browser API Mocking

```typescript
// Window.open for print functionality
Object.defineProperty(window, "open", {
  value: vi.fn(() => mockPrintWindow),
});

// LocalStorage and SessionStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
```

## Running Tests

### All Tests

```bash
bun test
```

### Specific Test Files

```bash
bun test usePOSOperations.test.ts
bun test integration.test.ts
bun test components.test.tsx
```

### With Coverage

```bash
bun test --coverage
```

### Watch Mode

```bash
bun test --watch
```

### UI Mode

```bash
bun test --ui
```

## Test Data

### Mock Products

```typescript
const mockProduct: Product = {
  id: "prod-123",
  name: "Premium Hair Extension",
  barcode: "123456789",
  price: 89.99,
  category: "Hair Extensions",
  inStock: true,
  quantityAvailable: 10,
  skuId: "sku-123",
  productId: "prod-123",
};
```

### Mock Customers

```typescript
const mockCustomer: CustomerInfo = {
  customerId: "cust-123",
  name: "John Doe",
  email: "john@example.com",
  phone: "+1234567890",
};
```

## Bug Fixes Tested

### 1. Inventory Validation Race Condition

- **Problem**: Multiple items of same product could exceed available inventory
- **Solution**: Cumulative quantity validation by SKU
- **Test**: `backend.test.ts` - "should validate cumulative quantities"

### 2. Print Window Reopening

- **Problem**: Print window would reopen after being closed
- **Solution**: Added `isClosing` flag and proper event handling
- **Test**: `usePrint.test.ts` - "should prevent multiple close attempts"

### 3. Customer Panel Collapsing

- **Problem**: Typing in customer info would close the panel
- **Solution**: Separate `updateCustomerInfo` vs `selectCustomer` methods
- **Test**: `usePOSOperations.test.ts` - "should update customer info without closing panel"

### 4. POS Transaction Numbers

- **Problem**: Inconsistent transaction number formats
- **Solution**: Unified "POS-" prefix generation
- **Test**: `backend.test.ts` - "should generate POS transaction number"

## Performance Considerations

### Test Optimization

- Use `vi.clearAllMocks()` in `beforeEach` to prevent test pollution
- Mock heavy operations like API calls and DOM manipulation
- Use `act()` wrapper for state updates in React components
- Parallel test execution where possible

### Memory Management

- Clean up event listeners in test teardown
- Reset store state between tests
- Clear timers and intervals

## Continuous Integration

### Test Pipeline

1. **Lint Check** - ESLint validation
2. **Type Check** - TypeScript compilation
3. **Unit Tests** - Individual component/function tests
4. **Integration Tests** - End-to-end workflow tests
5. **Coverage Report** - Minimum 80% coverage requirement

### Quality Gates

- ✅ All tests must pass
- ✅ Coverage > 80%
- ✅ No TypeScript errors
- ✅ No ESLint violations

## Future Test Enhancements

### Planned Additions

- [ ] Visual regression tests for receipt layouts
- [ ] Performance tests for large cart operations
- [ ] Accessibility tests for screen readers
- [ ] Mobile responsiveness tests
- [ ] Real device barcode scanning tests

### Test Data Management

- [ ] Factory functions for test data generation
- [ ] Shared test fixtures
- [ ] Database seeding for integration tests

## Debugging Tests

### Common Issues

1. **Async Operations**: Use `await act(async () => ...)` for async state updates
2. **Timer Issues**: Use `vi.useFakeTimers()` and `vi.advanceTimersByTime()`
3. **Mock Pollution**: Ensure `vi.clearAllMocks()` in `beforeEach`
4. **Component Rendering**: Use `@testing-library/react` utilities properly

### Debug Commands

```bash
# Run single test with debug output
bun test --reporter=verbose usePOSOperations.test.ts

# Run with coverage and open report
bun test --coverage && open coverage/index.html
```

This comprehensive test suite ensures the POS system is robust, reliable, and ready for production use.
