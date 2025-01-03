import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_layout/account')({
  component: () => <div>Hello /_layout/account!</div>,
})
