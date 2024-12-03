import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute(
  '/_layout/_shopLayout/shop/$categorySlug/',
)({
  component: () => <div>Hello /_layout/_shopLayout/shop/$categorySlug/!</div>,
})
