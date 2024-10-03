import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/$categorySlug')({
  component: () => <div>Hello /$categorySlug!</div>
})