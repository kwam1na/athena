import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute(
  '/_authed/$orgUrlSlug/store/$storeUrlSlug/orders/',
)({
  component: () => <div>Hello /$orgUrlSlug/store/$storeUrlSlug/orders/!</div>,
})
