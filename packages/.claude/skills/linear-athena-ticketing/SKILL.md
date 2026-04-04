---
name: linear-athena-ticketing
description: Use when you need to generate an implementation plan and convert it into atomic, parallelizable Linear tickets for Athena work. Triggers when the user asks to create tickets, plan work for Linear, structure issues for parallel execution, or break down a feature into trackable units. Do NOT use when tickets already exist and the user wants implementation — hand off to executing-athena-linear-tickets instead.
---

# Linear Athena Ticketing

Turn active Athena work into a concrete implementation plan and then into Linear issues that are atomic, parallelizable, and testable. Execute the entire workflow — from understanding scope through creating Linear issues — without pausing for confirmation between steps.

If the tickets already exist and the user wants implementation, hand off to `executing-athena-linear-tickets` immediately.

## When to Use

- The user asks to create tickets from current work
- The user wants planning first, then ticket creation
- The user wants issues structured for parallel execution
- The user describes a feature or initiative that needs to be broken into trackable units

Do not use when:
- The relevant Athena tickets already exist
- The user is asking to implement or continue implementation
- The main problem is ticket execution hygiene rather than ticket creation

## Autonomy Model

Execute the full workflow from planning through Linear issue creation without stopping for confirmation at each step. The user gets a complete set of created tickets as the deliverable, not a draft plan waiting for approval.

**Act autonomously when:**
- The scope is clear enough to decompose into tasks
- Ticket boundaries follow naturally from the plan
- Labels and dependencies are deterministic from the code areas involved

**Pause and ask only when:**
- The scope is genuinely ambiguous and two reasonable interpretations lead to materially different ticket sets
- You cannot determine whether work should be one ticket or three without understanding the user's shipping preference
- A parent issue or milestone assignment is unclear and would affect prioritization

Default to creating the tickets. The user can restructure after the fact — an imperfect set of tickets that exists is more useful than a perfect plan that's still in your head.

## Defaults

- Team: `V26` (`yaegars`)
- Project: `athena`
- Common package labels (apply only when relevant):
  - `pkg:athena-webapp`
  - `pkg:storefront-webapp`

## Workflow

Execute steps 0 through 6 as a continuous sequence.

### 0. Confirm This Is Ticket Creation Work

- If the tickets already exist, stop and use `executing-athena-linear-tickets`
- If the user is mixing both intents, do ticket creation first, then explicitly hand execution off to `executing-athena-linear-tickets`

### 1. Generate a Plan

- Use `superpowers:writing-plans` as the primary planning step
- Plan output should be a checklist of concrete implementation tasks
- Each task should describe a shippable unit of work, not a vague objective

### 2. Normalize Plan Items Into Ticket Candidates

- Convert each actionable checklist item into one ticket candidate
- Merge items only when they are inseparable in implementation and validation
- Split items when they can be shipped and tested independently
- Do not force frontend/backend splits unless they arise naturally from the plan

### 3. Enforce Atomicity and Parallelizability

Each ticket must satisfy:
- **One shippable outcome** — a single concrete result that can be validated
- **Independently mergeable** — the PR for this ticket should not require another ticket's PR to land first, unless explicitly marked as blocked
- **Independently testable** — acceptance criteria can be verified without completing other tickets

Capture dependency edges only when a ticket is truly blocked. Minimize dependency chains — restructure tickets to maximize what can start in parallel.

### 4. Build Ticket Bodies

Every ticket body must include:

```md
## Scope
What this ticket covers and explicitly does not cover.

## Acceptance Criteria
- [ ] Concrete, verifiable criterion
- [ ] Another criterion

## Test Scenarios
- Scenario: [description]
  - Given: [precondition]
  - When: [action]
  - Then: [expected result]
```

Include security, authorization, or idempotency scenarios when payment or checkout behavior is touched.

### 5. Create Issues in Linear

- Use Linear MCP operations directly — do not ask for permission to create issues
- Check for near-identical active issues before creating to avoid duplicates
- Apply labels based on impacted code areas and domain
- Set parent issues and milestone when relevant context exists
- If a mutation fails, retry once, then note the failure and continue with remaining tickets

### 6. Return Complete Handoff

Report the full result in this format:

**Created Issues:**
- `V26-XXX` — Title — [link] — labels: `pkg:athena-webapp`
- `V26-XXY` — Title — [link] — labels: `pkg:storefront-webapp`

**Execution Plan:**
- Can start now: `V26-XXX`, `V26-XXY`, `V26-XXZ`
- Blocked: `V26-XYZ` (blocked by `V26-XXX`)

**Assumptions:**
- Any team/project defaults applied, label mappings, or scope decisions made

**Next Step:**
- If implementation should follow, say: "Use `executing-athena-linear-tickets` to begin implementation." If the user indicated they want execution to follow immediately, proceed to that skill without asking.

## Quality Rules

- Optimize for minimum dependency chains and maximum parallel execution
- Avoid duplicate tickets — check active issues before creation
- Do not drift into implementation updates, branch strategy, or PR commentary beyond what's needed to define the tickets
- Make the execution boundary explicit: ticket creation ends when Linear is up to date and the execution order is clear
- When a ticket touches multiple packages, prefer one ticket per package unless the changes are trivially coupled

## Multi-Feature Ticketing

When the user describes multiple features or a large initiative:
- Decompose each feature independently
- Create a parent/umbrella issue when there are 4+ tickets for a single initiative
- Link child tickets to the parent
- Present the execution plan showing cross-feature dependencies

Proceed through the entire initiative without pausing between features.
