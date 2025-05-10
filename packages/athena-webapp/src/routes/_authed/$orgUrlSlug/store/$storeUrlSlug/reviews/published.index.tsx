import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute(
  '/_authed/$orgUrlSlug/store/$storeUrlSlug/reviews/published/',
)({
  component: RouteComponent,
})

function RouteComponent() {
  return (
    <div>
      Hello "/_authed/$orgUrlSlug/store/$storeUrlSlug/reviews/published/"!
    </div>
  )
}
