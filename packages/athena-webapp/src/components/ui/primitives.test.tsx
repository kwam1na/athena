import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Badge } from "./badge"
import { Button } from "./button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select"
import { Tabs, TabsList, TabsTrigger } from "./tabs"
import { Input } from "./input"
import { Textarea } from "./textarea"

describe("primitive sizing and token semantics", () => {
  it("uses tokenized destructive badge styles and badge sizing variants", () => {
    render(<Badge variant="destructive">Alert</Badge>)

    const badge = screen.getByText("Alert")

    expect(badge).toHaveClass("bg-destructive")
    expect(badge).toHaveClass("text-destructive-foreground")
    expect(badge).toHaveClass("h-6")
  })

  it("keeps outline buttons on the foreground token", () => {
    render(<Button variant="outline">Switch organization</Button>)

    const button = screen.getByRole("button", { name: "Switch organization" })

    expect(button).toHaveClass("bg-background")
    expect(button).toHaveClass("text-foreground")
  })

  it("exposes input sizing variants", () => {
    render(<Input aria-label="Search" size="lg" placeholder="Search" />)

    const input = screen.getByRole("textbox", { name: "Search" })

    expect(input).toHaveClass("h-11")
    expect(input).toHaveClass("px-4")
    expect(input).toHaveClass("text-base")
  })

  it("keeps the default input size at 16px on small screens", () => {
    render(<Input aria-label="Default search" placeholder="Search" />)

    const input = screen.getByRole("textbox", { name: "Default search" })

    expect(input).toHaveClass("text-base")
    expect(input).toHaveClass("md:text-sm")
  })

  it("exposes textarea sizing variants", () => {
    render(<Textarea aria-label="Notes" size="sm" placeholder="Notes" />)

    const textarea = screen.getByRole("textbox", { name: "Notes" })

    expect(textarea).toHaveClass("min-h-16")
    expect(textarea).toHaveClass("px-2.5")
    expect(textarea).toHaveClass("text-sm")
  })

  it("exposes select trigger sizing variants", () => {
    render(
      <Select>
        <SelectTrigger aria-label="Billing cadence" size="sm">
          <SelectValue placeholder="Choose cadence" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="weekly">Weekly</SelectItem>
        </SelectContent>
      </Select>
    )

    const trigger = screen.getByRole("combobox", { name: "Billing cadence" })

    expect(trigger).toHaveClass("h-9")
    expect(trigger).toHaveClass("px-2.5")
    expect(trigger).toHaveClass("text-sm")
  })

  it("exposes tab sizing variants", () => {
    render(
      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary" size="lg">
            Summary
          </TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
        </TabsList>
      </Tabs>
    )

    const tab = screen.getByRole("tab", { name: "Summary" })

    expect(tab).toHaveClass("h-11")
    expect(tab).toHaveClass("px-4")
    expect(tab).toHaveClass("text-base")
  })
})
