import { Icons } from "./icons";

type SpinnerProps = {
  size?: "sm" | "default" | "lg"
  className?: string
}

const sizeClasses = {
  sm: "h-4 w-4",
  default: "h-8 w-8",
  lg: "h-12 w-12",
} as const

export default function Spinner({ size = "default", className }: SpinnerProps) {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <Icons.spinner
        className={`animate-spin text-muted-foreground ${sizeClasses[size]} ${
          className ?? ""
        }`}
      />
    </div>
  )
}
