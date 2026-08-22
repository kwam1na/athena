/**
 * GENERATED FILE — do not edit. Run `bun run agent-sdk:generate`.
 *
 * Model-projectable capability schemas.
 *
 * Declarations and compact summaries only: no capability binding, no read
 * port, no dispatch target, and no compatibility identity. Grant filtering
 * happens per run in `convex/agentHarness/discovery.ts`, which imports this
 * module and never the privileged registry.
 */

import type { AgentCapabilitySchemaIndex } from "../discovery";

// #region AGENT_GENERATED_SCHEMAS_JSON
export const AGENT_GENERATED_CAPABILITY_SCHEMAS: AgentCapabilitySchemaIndex = {
  "declarations": {
    "cap_dailyops_activity": {
      "capabilityId": "cap_dailyops_activity",
      "citation": {
        "rule": "Cite the normalized event reference and the capture time of its source family.",
        "sourceRefKinds": [
          "timeline_event"
        ]
      },
      "completeness": {
        "rule": "Reflects both the page boundary and which source families the read covered.",
        "sourceKeys": [
          "pages",
          "sourceFamilies"
        ]
      },
      "contractVersion": 1,
      "cost": {
        "worstCasePerCall": {
          "bytes": 196608,
          "calls": 1,
          "costUnits": 3,
          "elapsedMs": 2500,
          "rows": 100
        }
      },
      "egressClass": "operational",
      "evidence": {
        "mode": "provenance_only",
        "reason": "Events are immutable references; the row itself is the evidence."
      },
      "examples": [
        {
          "args": {
            "operatingDate": "2026-08-21"
          },
          "description": "Newest page of normalized activity for the current operating day.",
          "title": "What happened today?",
          "verb": "list"
        }
      ],
      "freshness": {
        "authority": "live_read",
        "classes": [
          "live"
        ],
        "rule": "Ordered by event time, but each source family is captured separately at read time."
      },
      "lifecycle": "enabled",
      "namespace": {
        "package": "operations",
        "resource": "activity"
      },
      "operations": {
        "list": {
          "bounds": {
            "kind": "collection",
            "maxItemsPerPage": 100,
            "maxPagesPerRun": 3
          },
          "filters": {
            "before": {
              "kind": "opaqueRef",
              "meaning": "Only return events strictly older than this event reference.",
              "refKind": "resource",
              "required": false
            },
            "operatingDate": {
              "kind": "operatingDate",
              "meaning": "Operating date in the store's calendar; the server derives the window through store time.",
              "required": true
            }
          },
          "purpose": "Page normalized timeline events for one operating date, newest first."
        }
      },
      "packageVersion": "1.0.0",
      "projections": {
        "financialEvents": {
          "egressClass": "sensitive",
          "meaning": "Manager review and financial event detail; omitted entirely below manager.",
          "requires": {
            "tier": "manager"
          }
        }
      },
      "purpose": "What happened on an operating day, newest first, normalized across operational source families.",
      "result": {
        "fields": {
          "eventKind": {
            "kind": "string",
            "meaning": "Normalized event type within its family."
          },
          "eventRef": {
            "kind": "opaqueRef",
            "meaning": "Opaque reference to the timeline event.",
            "refKind": "resource"
          },
          "family": {
            "kind": "enum",
            "meaning": "Source family the event was normalized from.",
            "values": [
              "operational_event",
              "register_closeout",
              "register_count"
            ]
          },
          "financialDetail": {
            "kind": "text",
            "meaning": "Financial and manager-review detail carried by the event.",
            "projection": "financialEvents"
          },
          "occurredAt": {
            "kind": "timestamp",
            "meaning": "When the event happened (event time, not capture time)."
          },
          "operatingDate": {
            "kind": "operatingDate",
            "meaning": "Operating date the event falls in."
          },
          "operatingWindow": {
            "fields": {
              "derivation": {
                "kind": "enum",
                "meaning": "`schedule`: a store schedule version governed this date. `utc_fallback`: none did, so the calendar day was used.",
                "values": [
                  "schedule",
                  "utc_fallback"
                ]
              },
              "timezone": {
                "kind": "string",
                "meaning": "Store timezone the window was derived in.",
                "optional": true
              }
            },
            "kind": "object",
            "meaning": "How the server derived this operating day's window."
          },
          "subjectKind": {
            "kind": "string",
            "meaning": "Kind of record the event is about."
          },
          "subjectLabel": {
            "kind": "string",
            "meaning": "Readable label of that record.",
            "optional": true
          },
          "summary": {
            "kind": "text",
            "meaning": "Operator-facing one-line description of the event."
          }
        }
      },
      "scope": {
        "kind": "store"
      }
    },
    "cap_dailyops_approvals": {
      "capabilityId": "cap_dailyops_approvals",
      "citation": {
        "rule": "Cite the request reference and its current state version.",
        "sourceRefKinds": [
          "approval_request"
        ]
      },
      "completeness": {
        "rule": "Complete only when every page of the pending partition has been consumed.",
        "sourceKeys": [
          "pages"
        ]
      },
      "contractVersion": 1,
      "cost": {
        "worstCasePerCall": {
          "bytes": 196608,
          "calls": 1,
          "costUnits": 3,
          "elapsedMs": 2500,
          "rows": 100
        }
      },
      "egressClass": "operational",
      "evidence": {
        "mode": "provenance_only",
        "reason": "Pending state changes as soon as a reviewer acts."
      },
      "examples": [
        {
          "args": {
            "operatingDate": "2026-08-21",
            "state": "pending"
          },
          "description": "First page of approvals still awaiting a decision.",
          "title": "Pending approvals today",
          "verb": "list"
        }
      ],
      "freshness": {
        "authority": "live_read",
        "classes": [
          "live"
        ],
        "rule": "Live queue state at capture time."
      },
      "lifecycle": "enabled",
      "namespace": {
        "package": "operations",
        "resource": "approvals"
      },
      "operations": {
        "list": {
          "bounds": {
            "kind": "collection",
            "maxItemsPerPage": 100,
            "maxPagesPerRun": 2
          },
          "filters": {
            "operatingDate": {
              "kind": "operatingDate",
              "meaning": "Operating date in the store's calendar; the server derives the window through store time.",
              "required": true
            },
            "state": {
              "kind": "enum",
              "meaning": "Only pending requests are listable in v1; decided requests are audit history.",
              "required": true,
              "values": [
                "pending"
              ]
            }
          },
          "purpose": "Page pending approval requests for one operating date, newest first."
        }
      },
      "packageVersion": "1.0.0",
      "projections": {
        "approvalProof": {
          "egressClass": "sensitive",
          "meaning": "Approval proof and reviewer details; omitted entirely below full admin.",
          "requires": {
            "tier": "full_admin"
          }
        }
      },
      "purpose": "Approval requests still awaiting a decision on an operating day.",
      "result": {
        "fields": {
          "approvalProof": {
            "kind": "text",
            "meaning": "Reviewer identity and approval proof attached to the request.",
            "projection": "approvalProof"
          },
          "operatingDate": {
            "kind": "operatingDate",
            "meaning": "Operating date the request belongs to."
          },
          "raisedAt": {
            "kind": "timestamp",
            "meaning": "When the request was raised."
          },
          "reason": {
            "kind": "text",
            "meaning": "Reason recorded when the request was raised.",
            "optional": true
          },
          "requestKind": {
            "kind": "string",
            "meaning": "What is being approved (variance review, void, …)."
          },
          "requestRef": {
            "kind": "opaqueRef",
            "meaning": "Opaque reference to the approval request.",
            "refKind": "resource"
          },
          "state": {
            "kind": "enum",
            "meaning": "Current state of the request.",
            "values": [
              "pending"
            ]
          },
          "stateVersion": {
            "kind": "string",
            "meaning": "Version token of the current state, for citation."
          },
          "subjectKind": {
            "kind": "string",
            "meaning": "Kind of record the request is about."
          }
        }
      },
      "scope": {
        "kind": "store"
      }
    },
    "cap_dailyops_attention": {
      "capabilityId": "cap_dailyops_attention",
      "citation": {
        "rule": "Cite the work-item and approval-request references plus the capture time.",
        "sourceRefKinds": [
          "work_item",
          "approval_request",
          "store_day_record"
        ]
      },
      "completeness": {
        "rule": "Derived from every contributing lane and from page exhaustion, never from a single boolean.",
        "sourceKeys": [
          "lanes",
          "pages"
        ]
      },
      "contractVersion": 1,
      "cost": {
        "worstCasePerCall": {
          "bytes": 196608,
          "calls": 1,
          "costUnits": 3,
          "elapsedMs": 2500,
          "rows": 100
        }
      },
      "egressClass": "operational",
      "evidence": {
        "mode": "provenance_only",
        "reason": "Queue membership is transient; a slice would age out of truth."
      },
      "examples": [
        {
          "args": {
            "operatingDate": "2026-08-21",
            "status": "blocking"
          },
          "description": "Only the items that hold up the end-of-day close.",
          "title": "What is blocking the close?",
          "verb": "list"
        }
      ],
      "freshness": {
        "authority": "live_read",
        "classes": [
          "live"
        ],
        "rule": "Live queue snapshot at capture time."
      },
      "lifecycle": "enabled",
      "namespace": {
        "package": "operations",
        "resource": "attention"
      },
      "operations": {
        "list": {
          "bounds": {
            "kind": "collection",
            "maxItemsPerPage": 100,
            "maxPagesPerRun": 2
          },
          "filters": {
            "operatingDate": {
              "kind": "operatingDate",
              "meaning": "Operating date in the store's calendar; the server derives the window through store time.",
              "required": true
            },
            "status": {
              "kind": "enum",
              "meaning": "Partition the queue by how strongly the item holds up the day.",
              "required": false,
              "values": [
                "blocking",
                "review",
                "informational"
              ]
            }
          },
          "purpose": "Page the attention queue for one operating date, most severe first."
        }
      },
      "packageVersion": "1.0.0",
      "projections": {
        "managerReasons": {
          "egressClass": "sensitive",
          "meaning": "Manager-only reasons and review evidence attached to an attention item.",
          "requires": {
            "tier": "manager"
          }
        }
      },
      "purpose": "Items on an operating day that need an operator, with the lane each one came from.",
      "result": {
        "fields": {
          "itemRef": {
            "kind": "opaqueRef",
            "meaning": "Opaque reference to the attention item.",
            "refKind": "resource"
          },
          "lane": {
            "kind": "enum",
            "meaning": "Which contributing lane raised the item.",
            "values": [
              "daily_opening",
              "daily_close",
              "operations_queue"
            ]
          },
          "managerReason": {
            "kind": "text",
            "meaning": "Manager-facing reason and evidence behind the item.",
            "projection": "managerReasons"
          },
          "operatingDate": {
            "kind": "operatingDate",
            "meaning": "Operating date the item belongs to."
          },
          "operatingWindow": {
            "fields": {
              "derivation": {
                "kind": "enum",
                "meaning": "`schedule`: a store schedule version governed this date. `utc_fallback`: none did, so the calendar day was used.",
                "values": [
                  "schedule",
                  "utc_fallback"
                ]
              },
              "timezone": {
                "kind": "string",
                "meaning": "Store timezone the window was derived in.",
                "optional": true
              }
            },
            "kind": "object",
            "meaning": "How the server derived this operating day's window."
          },
          "registerLabel": {
            "kind": "string",
            "meaning": "Register the item is about, when it concerns a drawer.",
            "optional": true
          },
          "status": {
            "kind": "enum",
            "meaning": "How strongly the item holds up the store day.",
            "values": [
              "blocking",
              "review",
              "informational"
            ]
          },
          "subjectKind": {
            "kind": "string",
            "meaning": "Kind of record the item is about (register session, work item, …)."
          },
          "subjectLabel": {
            "kind": "string",
            "meaning": "Readable label of that record.",
            "optional": true
          },
          "title": {
            "kind": "string",
            "meaning": "Short operator-facing title."
          }
        }
      },
      "scope": {
        "kind": "store"
      }
    },
    "cap_dailyops_automation": {
      "capabilityId": "cap_dailyops_automation",
      "citation": {
        "rule": "Cite the policy version and the run's idempotency and outcome references.",
        "sourceRefKinds": [
          "automation_run",
          "automation_policy"
        ]
      },
      "completeness": {
        "rule": "Reports the scheduled windows that produced no run, so a silent gap is never read as a clean day.",
        "sourceKeys": [
          "runs",
          "scheduledWindows"
        ]
      },
      "contractVersion": 1,
      "cost": {
        "worstCasePerCall": {
          "bytes": 98304,
          "calls": 1,
          "costUnits": 2,
          "elapsedMs": 2000,
          "rows": 50
        }
      },
      "egressClass": "operational",
      "evidence": {
        "mode": "provenance_only",
        "reason": "Ledger rows are immutable references; the row is the evidence."
      },
      "examples": [
        {
          "args": {
            "action": "opening.auto_start",
            "operatingDate": "2026-08-21"
          },
          "description": "Runs of the opening auto-start action on the current operating day.",
          "title": "Did automation open the store today?",
          "verb": "list"
        }
      ],
      "freshness": {
        "authority": "live_read",
        "classes": [
          "live"
        ],
        "rule": "The ledger is read live; it is evidence about automation, not the state of the store day."
      },
      "lifecycle": "enabled",
      "namespace": {
        "package": "automation",
        "resource": "dailyOperations"
      },
      "operations": {
        "list": {
          "bounds": {
            "kind": "collection",
            "maxItemsPerPage": 50,
            "maxPagesPerRun": 1
          },
          "filters": {
            "action": {
              "kind": "enum",
              "meaning": "Restrict to one automation action.",
              "required": false,
              "values": [
                "opening.auto_start",
                "eod.prepare",
                "eod.auto_complete"
              ]
            },
            "operatingDate": {
              "kind": "operatingDate",
              "meaning": "Operating date in the store's calendar; the server derives the window through store time.",
              "required": true
            }
          },
          "purpose": "Automation runs recorded for one operating date, newest first."
        }
      },
      "packageVersion": "1.0.0",
      "projections": {
        "policyDetails": {
          "egressClass": "sensitive",
          "meaning": "Policy thresholds and review evidence; omitted entirely below full admin.",
          "requires": {
            "tier": "full_admin"
          }
        }
      },
      "purpose": "What Athena's Daily Operations automation did on an operating day, and under which policy.",
      "result": {
        "fields": {
          "action": {
            "kind": "enum",
            "meaning": "Automation action the run performed.",
            "values": [
              "opening.auto_start",
              "eod.prepare",
              "eod.auto_complete"
            ]
          },
          "decisionReason": {
            "kind": "string",
            "meaning": "Short reason recorded with the outcome.",
            "optional": true
          },
          "disposition": {
            "kind": "enum",
            "meaning": "How an operator should read the outcome.",
            "values": [
              "failed",
              "action_taken",
              "needs_review",
              "policy_skipped",
              "scheduled_later"
            ]
          },
          "failure": {
            "fields": {
              "code": {
                "kind": "string",
                "meaning": "Failure code."
              },
              "message": {
                "kind": "text",
                "meaning": "Failure message."
              }
            },
            "kind": "object",
            "meaning": "Recorded failure, when the run failed.",
            "optional": true
          },
          "idempotencyToken": {
            "kind": "string",
            "meaning": "Idempotency token of the run, for citation."
          },
          "lane": {
            "kind": "enum",
            "meaning": "Which lane of the store day the action serves.",
            "values": [
              "opening",
              "close"
            ]
          },
          "occurredAt": {
            "kind": "timestamp",
            "meaning": "When the run reached its outcome."
          },
          "operatingDate": {
            "kind": "operatingDate",
            "meaning": "Operating date the run was scheduled for."
          },
          "operatingWindow": {
            "fields": {
              "derivation": {
                "kind": "enum",
                "meaning": "`schedule`: a store schedule version governed this date. `utc_fallback`: none did, so the calendar day was used.",
                "values": [
                  "schedule",
                  "utc_fallback"
                ]
              },
              "timezone": {
                "kind": "string",
                "meaning": "Store timezone the window was derived in.",
                "optional": true
              }
            },
            "kind": "object",
            "meaning": "How the server derived this operating day's window."
          },
          "outcome": {
            "kind": "enum",
            "meaning": "What the run concluded.",
            "values": [
              "disabled",
              "dry_run",
              "skipped",
              "prepared",
              "eligible",
              "applied",
              "failed"
            ]
          },
          "policyEvidence": {
            "fields": {
              "eligible": {
                "kind": "boolean",
                "meaning": "Whether the gate considered the run eligible.",
                "optional": true
              },
              "gates": {
                "items": {
                  "fields": {
                    "key": {
                      "kind": "string",
                      "meaning": "Gate key."
                    },
                    "passed": {
                      "kind": "boolean",
                      "meaning": "Whether the gate passed."
                    },
                    "reason": {
                      "kind": "text",
                      "meaning": "Why the gate failed.",
                      "optional": true
                    }
                  },
                  "kind": "object",
                  "meaning": "One gate."
                },
                "kind": "array",
                "maxItems": 20,
                "meaning": "Individual gates the policy evaluated."
              },
              "kind": {
                "kind": "string",
                "meaning": "Evidence kind."
              }
            },
            "kind": "object",
            "meaning": "Policy thresholds and gate evidence behind the decision.",
            "projection": "policyDetails"
          },
          "policyMode": {
            "kind": "enum",
            "meaning": "Mode the governing policy was in.",
            "values": [
              "disabled",
              "dry_run",
              "enabled"
            ]
          },
          "policyVersion": {
            "kind": "string",
            "meaning": "Version of the policy the run applied."
          },
          "runRef": {
            "kind": "opaqueRef",
            "meaning": "Opaque reference to the automation run record.",
            "refKind": "source"
          }
        }
      },
      "scope": {
        "kind": "store"
      }
    },
    "cap_dailyops_day_sales": {
      "capabilityId": "cap_dailyops_day_sales",
      "citation": {
        "rule": "Cite the report revision when folded, or the live day snapshot hash otherwise, plus the capture time.",
        "sourceRefKinds": [
          "report_revision",
          "live_snapshot",
          "sku_snapshot"
        ]
      },
      "completeness": {
        "rule": "Each sub-source reports its own coverage; the aggregate is their minimum.",
        "sourceKeys": [
          "report",
          "topItems",
          "paymentMix"
        ]
      },
      "contractVersion": 1,
      "cost": {
        "worstCasePerCall": {
          "bytes": 131072,
          "calls": 1,
          "costUnits": 2,
          "elapsedMs": 2000,
          "rows": 120
        }
      },
      "egressClass": "operational",
      "evidence": {
        "claimShapes": [
          "transactionCount"
        ],
        "extractorKey": "reports.daySales",
        "extractorVersion": "1",
        "mode": "extractor"
      },
      "examples": [
        {
          "args": {
            "operatingDate": "2026-08-20"
          },
          "description": "The accepted report for a closed day.",
          "title": "Yesterday's sales",
          "verb": "get"
        }
      ],
      "freshness": {
        "authority": "authoritative_record",
        "classes": [
          "accepted",
          "live"
        ],
        "rule": "The folded report record is authoritative after close; before it, the day is an explicitly live preview."
      },
      "lifecycle": "enabled",
      "namespace": {
        "package": "reports",
        "resource": "daySales"
      },
      "operations": {
        "get": {
          "bounds": {
            "kind": "snapshot",
            "maxEmbeddedItems": 110
          },
          "filters": {
            "operatingDate": {
              "kind": "operatingDate",
              "meaning": "Operating date in the store's calendar; the server derives the window through store time.",
              "required": true
            }
          },
          "purpose": "One day summary from the accepted report when folded, otherwise the live operating-day preview."
        }
      },
      "packageVersion": "1.0.0",
      "projections": {
        "financial": {
          "egressClass": "sensitive",
          "meaning": "Revenue, refunds, profit, payment groups, and top-item value; omitted entirely below full admin.",
          "requires": {
            "tier": "full_admin"
          }
        }
      },
      "purpose": "One operating day of sales: volume, revenue, payment groups, and the top items behind them.",
      "result": {
        "fields": {
          "grossProfit": {
            "kind": "money",
            "meaning": "Gross profit, absent when any revenue is uncosted.",
            "projection": "financial",
            "valueState": true
          },
          "grossRevenue": {
            "kind": "money",
            "meaning": "Gross sales before refunds.",
            "projection": "financial",
            "valueState": true
          },
          "operatingDate": {
            "kind": "operatingDate",
            "meaning": "Operating date this summary describes."
          },
          "operatingWindow": {
            "fields": {
              "derivation": {
                "kind": "enum",
                "meaning": "`schedule`: a store schedule version governed this date. `utc_fallback`: none did, so the calendar day was used.",
                "values": [
                  "schedule",
                  "utc_fallback"
                ]
              },
              "timezone": {
                "kind": "string",
                "meaning": "Store timezone the window was derived in.",
                "optional": true
              }
            },
            "kind": "object",
            "meaning": "How the server derived this operating day's window."
          },
          "paymentGroups": {
            "items": {
              "fields": {
                "amount": {
                  "kind": "money",
                  "meaning": "Gross amount collected through the method."
                },
                "method": {
                  "kind": "string",
                  "meaning": "Payment method."
                },
                "shareBasisPoints": {
                  "kind": "integer",
                  "meaning": "Share of the day's payments, in basis points."
                },
                "tenderUseCount": {
                  "kind": "integer",
                  "meaning": "Number of tender uses."
                }
              },
              "kind": "object",
              "meaning": "One payment method group."
            },
            "kind": "array",
            "maxItems": 50,
            "meaning": "Gross payments by method, present only when the mix reconciles to the day's total.",
            "projection": "financial"
          },
          "recordRevision": {
            "kind": "string",
            "meaning": "Certified fold revision of the accepted record, when the day has been folded.",
            "optional": true
          },
          "recordState": {
            "kind": "enum",
            "meaning": "State of the underlying daily report record; `open` is a preview, `absent` means no record exists.",
            "values": [
              "open",
              "provisional",
              "reconciled",
              "amended",
              "absent"
            ]
          },
          "refunds": {
            "kind": "money",
            "meaning": "Refunds issued on the day.",
            "projection": "financial",
            "valueState": true
          },
          "revenue": {
            "kind": "money",
            "meaning": "Net sales for the day.",
            "projection": "financial",
            "valueState": true
          },
          "topItems": {
            "items": {
              "fields": {
                "displayName": {
                  "kind": "string",
                  "meaning": "Catalogue name of the item."
                },
                "quantity": {
                  "kind": "quantity",
                  "meaning": "Units sold."
                },
                "skuCode": {
                  "kind": "string",
                  "meaning": "Business code of the SKU.",
                  "optional": true
                },
                "skuRef": {
                  "kind": "opaqueRef",
                  "meaning": "Opaque reference to the SKU.",
                  "refKind": "resource"
                },
                "value": {
                  "kind": "money",
                  "meaning": "Net sales attributed to the item.",
                  "projection": "financial"
                }
              },
              "kind": "object",
              "meaning": "One item's contribution to the day."
            },
            "kind": "array",
            "maxItems": 50,
            "meaning": "Top items by units sold on the day."
          },
          "transactionCount": {
            "kind": "integer",
            "meaning": "Completed transactions settled on the day."
          },
          "unitsReturned": {
            "kind": "integer",
            "meaning": "Units returned on the day."
          },
          "unitsSold": {
            "kind": "integer",
            "meaning": "Units sold on the day."
          }
        }
      },
      "scope": {
        "kind": "store"
      }
    },
    "cap_dailyops_inventory_positions": {
      "capabilityId": "cap_dailyops_inventory_positions",
      "citation": {
        "rule": "Cite the SKU snapshot reference and the capture time.",
        "sourceRefKinds": [
          "sku_snapshot"
        ]
      },
      "completeness": {
        "rule": "Page exhaustion determines collection completeness; a partial read says so.",
        "sourceKeys": [
          "positions"
        ]
      },
      "contractVersion": 1,
      "cost": {
        "worstCasePerCall": {
          "bytes": 196608,
          "calls": 1,
          "costUnits": 3,
          "elapsedMs": 2500,
          "rows": 100
        }
      },
      "egressClass": "operational",
      "evidence": {
        "claimShapes": [
          "onHand"
        ],
        "extractorKey": "inventory.positions",
        "extractorVersion": "1",
        "mode": "extractor"
      },
      "examples": [
        {
          "args": {
            "stockState": "low"
          },
          "description": "Positions under stock pressure.",
          "title": "What is running low?",
          "verb": "list"
        },
        {
          "args": {
            "skuRef": "resource:product_sku.7c1d.a20f"
          },
          "description": "Stock position for a SKU previously returned by `list`.",
          "title": "One SKU's position",
          "verb": "get"
        }
      ],
      "freshness": {
        "authority": "live_read",
        "classes": [
          "live"
        ],
        "rule": "Live stock position at capture time."
      },
      "lifecycle": "enabled",
      "namespace": {
        "package": "inventory",
        "resource": "positions"
      },
      "operations": {
        "get": {
          "bounds": {
            "kind": "snapshot",
            "maxEmbeddedItems": 10
          },
          "filters": {
            "skuRef": {
              "kind": "opaqueRef",
              "meaning": "Reference minted by this resource's `list`; a guessed reference resolves to nothing.",
              "refKind": "resource",
              "required": true
            }
          },
          "purpose": "One SKU's stock position."
        },
        "list": {
          "bounds": {
            "kind": "collection",
            "maxItemsPerPage": 100,
            "maxPagesPerRun": 3
          },
          "filters": {
            "category": {
              "kind": "string",
              "meaning": "Restrict to one catalogue category name.",
              "required": false
            },
            "stockState": {
              "kind": "enum",
              "meaning": "Restrict to a stock-pressure band.",
              "required": false,
              "values": [
                "in_stock",
                "low",
                "out"
              ]
            }
          },
          "purpose": "Page stock positions for the store."
        }
      },
      "packageVersion": "1.0.0",
      "projections": {
        "costOverlay": {
          "egressClass": "sensitive",
          "meaning": "Unit cost and stock value. Requires the cost-overlay read intent; without it the fields are absent, never zero.",
          "requires": {
            "tier": "member"
          }
        }
      },
      "purpose": "Live stock position for the store's sellable SKUs.",
      "result": {
        "fields": {
          "adjustmentBlockedReason": {
            "kind": "string",
            "meaning": "Why stock adjustments are currently blocked for this SKU.",
            "optional": true
          },
          "available": {
            "kind": "quantity",
            "meaning": "Units sellable right now."
          },
          "category": {
            "kind": "string",
            "meaning": "Catalogue category.",
            "optional": true
          },
          "displayName": {
            "kind": "string",
            "meaning": "Catalogue name of the item."
          },
          "onHand": {
            "kind": "quantity",
            "meaning": "Units physically on hand."
          },
          "reserved": {
            "kind": "quantity",
            "meaning": "Units held by open carts or checkouts."
          },
          "skuCode": {
            "kind": "string",
            "meaning": "Business code of the SKU.",
            "optional": true
          },
          "skuRef": {
            "kind": "opaqueRef",
            "meaning": "Opaque reference to the SKU.",
            "refKind": "resource"
          },
          "stockState": {
            "kind": "enum",
            "meaning": "Stock-pressure band derived from the available quantity.",
            "values": [
              "in_stock",
              "low",
              "out"
            ]
          },
          "stockValue": {
            "kind": "money",
            "meaning": "On-hand units valued at cost.",
            "projection": "costOverlay",
            "valueState": true
          },
          "subcategory": {
            "kind": "string",
            "meaning": "Catalogue subcategory.",
            "optional": true
          },
          "unitCost": {
            "kind": "money",
            "meaning": "Cost basis per unit.",
            "projection": "costOverlay",
            "valueState": true
          },
          "variantLabel": {
            "kind": "string",
            "meaning": "Variant (size, colour) label.",
            "optional": true
          }
        }
      },
      "scope": {
        "kind": "store"
      }
    },
    "cap_dailyops_register_sessions": {
      "capabilityId": "cap_dailyops_register_sessions",
      "citation": {
        "rule": "Cite the session reference and its closeout version; never a raw identifier.",
        "sourceRefKinds": [
          "register_session",
          "closeout"
        ]
      },
      "completeness": {
        "rule": "Complete only after every status partition and every page has been consumed.",
        "sourceKeys": [
          "partitions",
          "pages"
        ]
      },
      "contractVersion": 1,
      "cost": {
        "worstCasePerCall": {
          "bytes": 196608,
          "calls": 1,
          "costUnits": 3,
          "elapsedMs": 2500,
          "rows": 100
        }
      },
      "egressClass": "operational",
      "evidence": {
        "claimShapes": [
          "status"
        ],
        "extractorKey": "cash.registerSessions",
        "extractorVersion": "1",
        "mode": "extractor"
      },
      "examples": [
        {
          "args": {
            "operatingDate": "2026-08-21",
            "status": "open"
          },
          "description": "Open register sessions on the current operating day.",
          "title": "Which drawers are still open?",
          "verb": "list"
        },
        {
          "args": {
            "sessionRef": "resource:register_session.4f2a.9b1c"
          },
          "description": "Snapshot of a session previously returned by `list`.",
          "title": "One drawer's closeout",
          "verb": "get"
        }
      ],
      "freshness": {
        "authority": "live_read",
        "classes": [
          "live"
        ],
        "rule": "Live session state at capture time."
      },
      "lifecycle": "enabled",
      "namespace": {
        "package": "cash",
        "resource": "registerSessions"
      },
      "operations": {
        "get": {
          "bounds": {
            "kind": "snapshot",
            "maxEmbeddedItems": 20
          },
          "filters": {
            "sessionRef": {
              "kind": "opaqueRef",
              "meaning": "Reference minted by this resource's `list`; a guessed reference resolves to nothing.",
              "refKind": "resource",
              "required": true
            }
          },
          "purpose": "One register session snapshot, including its closeout history."
        },
        "list": {
          "bounds": {
            "kind": "collection",
            "maxItemsPerPage": 100,
            "maxPagesPerRun": 2
          },
          "filters": {
            "operatingDate": {
              "kind": "operatingDate",
              "meaning": "Operating date in the store's calendar; the server derives the window through store time.",
              "required": true
            },
            "status": {
              "kind": "enum",
              "meaning": "Restrict to one session status partition.",
              "required": false,
              "values": [
                "open",
                "active",
                "closing",
                "closeout_rejected",
                "closed"
              ]
            }
          },
          "purpose": "Page register sessions touching one operating date, open drawers first."
        }
      },
      "packageVersion": "1.0.0",
      "projections": {
        "cashFinancials": {
          "egressClass": "sensitive",
          "meaning": "Cash totals, variance, deposits, and reviewer evidence; omitted entirely below full admin.",
          "requires": {
            "tier": "full_admin"
          }
        }
      },
      "purpose": "Register (drawer) sessions for an operating day and the closeout state of each one.",
      "result": {
        "fields": {
          "closedAt": {
            "kind": "timestamp",
            "meaning": "When the drawer was closed.",
            "optional": true
          },
          "closeoutEventCount": {
            "kind": "integer",
            "meaning": "Number of recorded closeout or reopen events."
          },
          "closeoutHistory": {
            "items": {
              "fields": {
                "countedCash": {
                  "kind": "money",
                  "meaning": "Counted cash at that moment.",
                  "optional": true
                },
                "expectedCash": {
                  "kind": "money",
                  "meaning": "Expected cash at that moment."
                },
                "kind": {
                  "kind": "enum",
                  "meaning": "What happened.",
                  "values": [
                    "closed",
                    "reopened"
                  ]
                },
                "occurredAt": {
                  "kind": "timestamp",
                  "meaning": "When it happened."
                },
                "reason": {
                  "kind": "text",
                  "meaning": "Reason recorded by the reviewer.",
                  "optional": true
                },
                "variance": {
                  "kind": "money",
                  "meaning": "Variance recorded at that moment.",
                  "optional": true
                }
              },
              "kind": "object",
              "meaning": "One closeout or reopen event."
            },
            "kind": "array",
            "maxItems": 20,
            "meaning": "Recorded closeout and reopen events for the session.",
            "projection": "cashFinancials"
          },
          "closeoutOperatingDate": {
            "kind": "operatingDate",
            "meaning": "Operating date the session was closed out on.",
            "optional": true
          },
          "closeoutVersion": {
            "kind": "string",
            "meaning": "Version token of the current closeout state, for citation."
          },
          "countedCash": {
            "kind": "money",
            "meaning": "Cash actually counted at closeout.",
            "projection": "cashFinancials",
            "valueState": true
          },
          "expectedCash": {
            "kind": "money",
            "meaning": "Cash the drawer should hold.",
            "projection": "cashFinancials",
            "valueState": true
          },
          "hasPendingApproval": {
            "kind": "boolean",
            "meaning": "Whether a manager approval is outstanding for the session."
          },
          "openedAt": {
            "kind": "timestamp",
            "meaning": "When the drawer was opened."
          },
          "openedOperatingDate": {
            "kind": "operatingDate",
            "meaning": "Operating date the session was opened on.",
            "optional": true
          },
          "openingFloat": {
            "kind": "money",
            "meaning": "Cash the drawer opened with.",
            "projection": "cashFinancials",
            "valueState": true
          },
          "operatingWindow": {
            "fields": {
              "derivation": {
                "kind": "enum",
                "meaning": "`schedule`: a store schedule version governed this date. `utc_fallback`: none did, so the calendar day was used.",
                "values": [
                  "schedule",
                  "utc_fallback"
                ]
              },
              "timezone": {
                "kind": "string",
                "meaning": "Store timezone the window was derived in.",
                "optional": true
              }
            },
            "kind": "object",
            "meaning": "How the server derived this operating day's window."
          },
          "registerLabel": {
            "kind": "string",
            "meaning": "Register the drawer belongs to."
          },
          "sessionRef": {
            "kind": "opaqueRef",
            "meaning": "Opaque reference to the register session.",
            "refKind": "resource"
          },
          "status": {
            "kind": "enum",
            "meaning": "Current session status.",
            "values": [
              "open",
              "active",
              "closing",
              "closeout_rejected",
              "closed"
            ]
          },
          "terminalLabel": {
            "kind": "string",
            "meaning": "Terminal the register was opened on.",
            "optional": true
          },
          "variance": {
            "kind": "money",
            "meaning": "Counted minus expected cash.",
            "projection": "cashFinancials",
            "valueState": true
          }
        }
      },
      "scope": {
        "kind": "store"
      }
    },
    "cap_dailyops_replenishment": {
      "capabilityId": "cap_dailyops_replenishment",
      "citation": {
        "rule": "Cite the recommendation reference plus the constituent SKU snapshot reference.",
        "sourceRefKinds": [
          "replenishment_recommendation",
          "sku_snapshot"
        ]
      },
      "completeness": {
        "rule": "Page exhaustion plus coverage of the procurement inputs the derivation needed.",
        "sourceKeys": [
          "recommendations",
          "inputs"
        ]
      },
      "contractVersion": 1,
      "cost": {
        "worstCasePerCall": {
          "bytes": 196608,
          "calls": 1,
          "costUnits": 3,
          "elapsedMs": 2500,
          "rows": 100
        }
      },
      "egressClass": "operational",
      "evidence": {
        "mode": "provenance_only",
        "reason": "Recommendations are re-derived; a stored slice would not reproduce."
      },
      "examples": [
        {
          "args": {
            "continuityStatus": "exposed"
          },
          "description": "SKUs with no cover at all.",
          "title": "What is exposed to running out?",
          "verb": "list"
        }
      ],
      "freshness": {
        "authority": "derived",
        "classes": [
          "derived",
          "live"
        ],
        "rule": "Re-derived on every read from stock and procurement inputs; the input freshness is reported per row."
      },
      "lifecycle": "enabled",
      "namespace": {
        "package": "inventory",
        "resource": "replenishment"
      },
      "operations": {
        "list": {
          "bounds": {
            "kind": "collection",
            "maxItemsPerPage": 100,
            "maxPagesPerRun": 2
          },
          "filters": {
            "continuityStatus": {
              "kind": "enum",
              "meaning": "Restrict to one continuity status.",
              "required": false,
              "values": [
                "exposed",
                "partially_covered",
                "planned",
                "inbound",
                "vendor_missing",
                "stale_planned_action",
                "late_inbound",
                "short_receipt",
                "cancelled_cover"
              ]
            }
          },
          "purpose": "Page replenishment recommendations, most exposed first."
        }
      },
      "packageVersion": "1.0.0",
      "projections": {
        "supplierCommercial": {
          "egressClass": "sensitive",
          "meaning": "Supplier cost and commitment detail; omitted entirely below full admin.",
          "requires": {
            "tier": "full_admin"
          }
        }
      },
      "purpose": "Replenishment recommendations derived from stock pressure and purchase-order coverage.",
      "result": {
        "fields": {
          "available": {
            "kind": "quantity",
            "meaning": "Units sellable right now."
          },
          "continuityStatus": {
            "kind": "enum",
            "meaning": "How exposed the SKU is to running out.",
            "values": [
              "exposed",
              "partially_covered",
              "planned",
              "inbound",
              "vendor_missing",
              "stale_planned_action",
              "late_inbound",
              "short_receipt",
              "cancelled_cover"
            ]
          },
          "derivationVersion": {
            "kind": "string",
            "meaning": "Version of the derivation that produced the recommendation."
          },
          "displayName": {
            "kind": "string",
            "meaning": "Catalogue name of the item."
          },
          "guidance": {
            "kind": "text",
            "meaning": "Operator-facing guidance for the recommendation."
          },
          "inboundQuantity": {
            "kind": "quantity",
            "meaning": "Units already inbound on purchase orders."
          },
          "inputFreshness": {
            "kind": "enum",
            "meaning": "Freshness of the stock and procurement inputs behind the recommendation.",
            "values": [
              "live",
              "stale"
            ]
          },
          "needsAction": {
            "kind": "boolean",
            "meaning": "Whether the recommendation asks an operator to act."
          },
          "nextExpectedAt": {
            "kind": "timestamp",
            "meaning": "When the next inbound receipt is expected.",
            "optional": true
          },
          "onHand": {
            "kind": "quantity",
            "meaning": "Units on hand."
          },
          "plannedQuantity": {
            "kind": "quantity",
            "meaning": "Units planned but not yet ordered."
          },
          "recommendationRef": {
            "kind": "opaqueRef",
            "meaning": "Opaque reference to the recommendation.",
            "refKind": "resource"
          },
          "skuCode": {
            "kind": "string",
            "meaning": "Business code of the SKU.",
            "optional": true
          },
          "skuRef": {
            "kind": "opaqueRef",
            "meaning": "Opaque reference to the SKU it concerns.",
            "refKind": "resource"
          },
          "suggestedOrderQuantity": {
            "kind": "quantity",
            "meaning": "Units the recommendation suggests ordering."
          },
          "supplierCommitment": {
            "fields": {
              "cancelledPurchaseOrderCount": {
                "kind": "integer",
                "meaning": "Cancelled purchase orders for the SKU."
              },
              "hasActiveVendor": {
                "kind": "boolean",
                "meaning": "Whether an active vendor can supply the SKU."
              },
              "openPurchaseOrderCount": {
                "kind": "integer",
                "meaning": "Open purchase orders covering the SKU."
              },
              "supplierCost": {
                "kind": "money",
                "meaning": "Last known supplier unit cost.",
                "optional": true
              }
            },
            "kind": "object",
            "meaning": "Supplier commercial commitment behind the recommendation.",
            "projection": "supplierCommercial"
          }
        }
      },
      "scope": {
        "kind": "store"
      }
    },
    "cap_dailyops_store_day": {
      "capabilityId": "cap_dailyops_store_day",
      "citation": {
        "rule": "Cite the opening and close record versions plus the capture time of the lifecycle read.",
        "sourceRefKinds": [
          "store_day_record",
          "close_record"
        ]
      },
      "completeness": {
        "rule": "Complete only when both the lifecycle read and the close-record read covered their sources.",
        "sourceKeys": [
          "lifecycle",
          "closeRecords"
        ]
      },
      "contractVersion": 1,
      "cost": {
        "worstCasePerCall": {
          "bytes": 131072,
          "calls": 1,
          "costUnits": 2,
          "elapsedMs": 2000,
          "rows": 120
        }
      },
      "egressClass": "operational",
      "evidence": {
        "claimShapes": [
          "lifecycleStage"
        ],
        "extractorKey": "operations.storeDay",
        "extractorVersion": "1",
        "mode": "extractor"
      },
      "examples": [
        {
          "args": {
            "operatingDate": "2026-08-21"
          },
          "description": "Lifecycle stage and readiness counts for the current operating day.",
          "title": "Is today ready to close?",
          "verb": "get"
        }
      ],
      "freshness": {
        "authority": "authoritative_record",
        "classes": [
          "live",
          "accepted"
        ],
        "rule": "Live while the day is open; the accepted close record is authoritative once the day is completed."
      },
      "lifecycle": "enabled",
      "namespace": {
        "package": "operations",
        "resource": "storeDay"
      },
      "operations": {
        "get": {
          "bounds": {
            "kind": "snapshot",
            "maxEmbeddedItems": 24
          },
          "filters": {
            "operatingDate": {
              "kind": "operatingDate",
              "meaning": "Operating date in the store's calendar; the server derives the window through store time.",
              "required": true
            }
          },
          "purpose": "One store-day snapshot: lifecycle stage, readiness counts, and record provenance."
        }
      },
      "packageVersion": "1.0.0",
      "projections": {
        "managerReview": {
          "egressClass": "sensitive",
          "meaning": "Manager review evidence recorded against the store day; omitted entirely below full admin.",
          "requires": {
            "tier": "full_admin"
          }
        }
      },
      "purpose": "Store-day lifecycle, readiness, and close state for one operating date, with the accepted opening and close records that prove it.",
      "result": {
        "fields": {
          "attentionCount": {
            "kind": "integer",
            "meaning": "Items currently needing an operator on this day."
          },
          "closeReadiness": {
            "fields": {
              "blockerCount": {
                "kind": "integer",
                "meaning": "Close items blocking completion."
              },
              "carryForwardCount": {
                "kind": "integer",
                "meaning": "Items that will carry into the next day."
              },
              "readyCount": {
                "kind": "integer",
                "meaning": "Close items already satisfied."
              },
              "reviewCount": {
                "kind": "integer",
                "meaning": "Close items awaiting review."
              }
            },
            "kind": "object",
            "meaning": "Counts of close items by disposition."
          },
          "closeRecordRef": {
            "kind": "opaqueRef",
            "meaning": "Accepted close record backing this snapshot.",
            "optional": true,
            "refKind": "source"
          },
          "closeStatus": {
            "kind": "enum",
            "meaning": "State of the end-of-day close record.",
            "values": [
              "not_started",
              "open",
              "completed",
              "reopened"
            ]
          },
          "completedCloseActor": {
            "kind": "enum",
            "meaning": "Whether a person or Athena automation completed the close.",
            "optional": true,
            "values": [
              "human",
              "automation"
            ]
          },
          "completedCloseAt": {
            "kind": "timestamp",
            "meaning": "When the close record was completed, if it has been.",
            "optional": true
          },
          "lifecycleStage": {
            "kind": "enum",
            "meaning": "Where the store day sits in the opening → operating → close lifecycle.",
            "values": [
              "not_opened",
              "operating",
              "close_blocked",
              "ready_to_close",
              "reopened",
              "closed"
            ]
          },
          "lifecycleSummary": {
            "kind": "string",
            "meaning": "One-line operator-facing description of the stage."
          },
          "managerReviewEvidence": {
            "items": {
              "fields": {
                "key": {
                  "kind": "string",
                  "meaning": "Stable key of the evidence entry."
                },
                "message": {
                  "kind": "text",
                  "meaning": "Reviewer-facing explanation."
                },
                "severity": {
                  "kind": "enum",
                  "meaning": "How the entry was classified.",
                  "values": [
                    "blocker",
                    "review",
                    "carry_forward"
                  ]
                },
                "title": {
                  "kind": "string",
                  "meaning": "Short title of the entry."
                }
              },
              "kind": "object",
              "meaning": "One review-evidence entry."
            },
            "kind": "array",
            "maxItems": 20,
            "meaning": "Manager review evidence recorded against the opening handoff.",
            "projection": "managerReview"
          },
          "openWorkItemCount": {
            "kind": "integer",
            "meaning": "Open operational work items."
          },
          "openingReadiness": {
            "fields": {
              "blockerCount": {
                "kind": "integer",
                "meaning": "Opening items blocking the day."
              },
              "carryForwardCount": {
                "kind": "integer",
                "meaning": "Items carried in from the prior day."
              },
              "readyCount": {
                "kind": "integer",
                "meaning": "Opening items already satisfied."
              },
              "reviewCount": {
                "kind": "integer",
                "meaning": "Opening items awaiting review."
              }
            },
            "kind": "object",
            "meaning": "Counts of opening items by disposition."
          },
          "openingRecordRef": {
            "kind": "opaqueRef",
            "meaning": "Accepted opening record backing this snapshot.",
            "optional": true,
            "refKind": "source"
          },
          "openingStatus": {
            "kind": "enum",
            "meaning": "Whether the opening handoff was started for this day.",
            "values": [
              "not_started",
              "started"
            ]
          },
          "operatingDate": {
            "kind": "operatingDate",
            "meaning": "Operating date this snapshot describes."
          },
          "operatingWindow": {
            "fields": {
              "derivation": {
                "kind": "enum",
                "meaning": "`schedule`: a store schedule version governed this date. `utc_fallback`: none did, so the calendar day was used.",
                "values": [
                  "schedule",
                  "utc_fallback"
                ]
              },
              "timezone": {
                "kind": "string",
                "meaning": "Store timezone the window was derived in.",
                "optional": true
              }
            },
            "kind": "object",
            "meaning": "How the server derived this operating day's window."
          },
          "pendingApprovalCount": {
            "kind": "integer",
            "meaning": "Approval requests still pending."
          },
          "registerBlockerCount": {
            "kind": "integer",
            "meaning": "Register sessions currently blocking the close."
          },
          "transactionCount": {
            "kind": "integer",
            "meaning": "Completed point-of-sale transactions on this day."
          }
        }
      },
      "scope": {
        "kind": "store"
      }
    },
    "cap_dailyops_store_pulse": {
      "capabilityId": "cap_dailyops_store_pulse",
      "citation": {
        "rule": "Cite each constituent summary source and its capture time.",
        "sourceRefKinds": [
          "summary_source"
        ]
      },
      "completeness": {
        "rule": "The aggregate is the minimum completeness of the contributing summaries.",
        "sourceKeys": [
          "sales",
          "comparison",
          "items"
        ]
      },
      "contractVersion": 1,
      "cost": {
        "worstCasePerCall": {
          "bytes": 131072,
          "calls": 1,
          "costUnits": 2,
          "elapsedMs": 2000,
          "rows": 120
        }
      },
      "egressClass": "operational",
      "evidence": {
        "mode": "provenance_only",
        "reason": "The pulse is a derivation; the constituent sources are the evidence."
      },
      "examples": [
        {
          "args": {
            "operatingDate": "2026-08-21",
            "window": "today"
          },
          "description": "Today's pulse against yesterday.",
          "title": "How is today trading?",
          "verb": "get"
        }
      ],
      "freshness": {
        "authority": "derived",
        "classes": [
          "derived",
          "live",
          "accepted"
        ],
        "rule": "A derivation over mixed-time sources, each individually timestamped by its own read."
      },
      "lifecycle": "enabled",
      "namespace": {
        "package": "reports",
        "resource": "storePulse"
      },
      "operations": {
        "get": {
          "bounds": {
            "kind": "snapshot",
            "maxEmbeddedItems": 40
          },
          "filters": {
            "operatingDate": {
              "kind": "operatingDate",
              "meaning": "Operating date in the store's calendar; the server derives the window through store time.",
              "required": true
            },
            "window": {
              "kind": "enum",
              "meaning": "Summary window, anchored on the operating date.",
              "required": true,
              "values": [
                "today",
                "week"
              ]
            }
          },
          "purpose": "One bounded pulse summary over a named window."
        }
      },
      "packageVersion": "1.0.0",
      "projections": {
        "financial": {
          "egressClass": "sensitive",
          "meaning": "Every financial pulse figure; omitted entirely below full admin.",
          "requires": {
            "tier": "full_admin"
          }
        }
      },
      "purpose": "A bounded trading pulse for today or the current week, with its own comparison window.",
      "result": {
        "fields": {
          "averageTransaction": {
            "kind": "money",
            "meaning": "Average basket value in the window.",
            "projection": "financial",
            "valueState": true
          },
          "busiestHour": {
            "fields": {
              "hour": {
                "kind": "integer",
                "meaning": "Hour of the day, store local."
              },
              "revenue": {
                "kind": "money",
                "meaning": "Sales in that hour.",
                "projection": "financial"
              },
              "transactionCount": {
                "kind": "integer",
                "meaning": "Transactions in that hour."
              }
            },
            "kind": "object",
            "meaning": "Busiest trading hour in the window.",
            "optional": true
          },
          "historyDayCount": {
            "kind": "integer",
            "meaning": "Days of history the trend is based on."
          },
          "isLimitedHistory": {
            "kind": "boolean",
            "meaning": "True when there is too little history for a stable trend."
          },
          "itemsSold": {
            "kind": "integer",
            "meaning": "Units sold in the window."
          },
          "operatingDate": {
            "kind": "operatingDate",
            "meaning": "Operating date the window is anchored on."
          },
          "operatingWindow": {
            "fields": {
              "derivation": {
                "kind": "enum",
                "meaning": "`schedule`: a store schedule version governed this date. `utc_fallback`: none did, so the calendar day was used.",
                "values": [
                  "schedule",
                  "utc_fallback"
                ]
              },
              "timezone": {
                "kind": "string",
                "meaning": "Store timezone the window was derived in.",
                "optional": true
              }
            },
            "kind": "object",
            "meaning": "How the server derived this operating day's window."
          },
          "revenue": {
            "kind": "money",
            "meaning": "Sales in the window.",
            "projection": "financial",
            "valueState": true
          },
          "revenueChangeBasisPoints": {
            "kind": "integer",
            "meaning": "Change against the comparison window, in basis points.",
            "projection": "financial"
          },
          "topItems": {
            "items": {
              "fields": {
                "displayName": {
                  "kind": "string",
                  "meaning": "Catalogue name of the item."
                },
                "quantity": {
                  "kind": "quantity",
                  "meaning": "Units sold."
                },
                "skuCode": {
                  "kind": "string",
                  "meaning": "Business code of the SKU.",
                  "optional": true
                },
                "value": {
                  "kind": "money",
                  "meaning": "Sales attributed to the item.",
                  "projection": "financial"
                }
              },
              "kind": "object",
              "meaning": "One item's contribution to the window."
            },
            "kind": "array",
            "maxItems": 10,
            "meaning": "Best-selling items in the window."
          },
          "transactionCount": {
            "kind": "integer",
            "meaning": "Completed transactions in the window."
          },
          "window": {
            "kind": "enum",
            "meaning": "Window the pulse covers.",
            "values": [
              "today",
              "week"
            ]
          }
        }
      },
      "scope": {
        "kind": "store"
      }
    },
    "cap_dailyops_week_performance": {
      "capabilityId": "cap_dailyops_week_performance",
      "citation": {
        "rule": "Cite each day's close revision or live read.",
        "sourceRefKinds": [
          "report_revision",
          "live_snapshot"
        ]
      },
      "completeness": {
        "rule": "Lists the days that could not be read; the aggregate is partial whenever any day is missing.",
        "sourceKeys": [
          "days"
        ]
      },
      "contractVersion": 1,
      "cost": {
        "worstCasePerCall": {
          "bytes": 131072,
          "calls": 1,
          "costUnits": 2,
          "elapsedMs": 2000,
          "rows": 120
        }
      },
      "egressClass": "operational",
      "evidence": {
        "mode": "provenance_only",
        "reason": "A week figure is a derivation across days, not a single record."
      },
      "examples": [
        {
          "args": {
            "weekEndOperatingDate": "2026-08-22"
          },
          "description": "Seven days ending Saturday plus the prior boundary day.",
          "title": "This week so far",
          "verb": "get"
        }
      ],
      "freshness": {
        "authority": "authoritative_record",
        "classes": [
          "accepted",
          "live"
        ],
        "rule": "Per-day frozen close metrics where the day is closed; explicitly live otherwise."
      },
      "lifecycle": "enabled",
      "namespace": {
        "package": "reports",
        "resource": "weekPerformance"
      },
      "operations": {
        "get": {
          "bounds": {
            "kind": "snapshot",
            "maxEmbeddedItems": 40
          },
          "filters": {
            "weekEndOperatingDate": {
              "kind": "operatingDate",
              "meaning": "Last operating date of the week; the server derives the seven-day span through store time.",
              "required": true
            }
          },
          "purpose": "Per-day metrics for the week ending at an operating date, each labelled with its own authority."
        }
      },
      "packageVersion": "1.0.0",
      "projections": {
        "financial": {
          "egressClass": "sensitive",
          "meaning": "Every financial metric in the week view; omitted entirely below full admin.",
          "requires": {
            "tier": "full_admin"
          }
        }
      },
      "purpose": "Seven operating days of performance ending on a chosen day, plus the prior week's boundary day.",
      "result": {
        "fields": {
          "days": {
            "items": {
              "fields": {
                "authority": {
                  "kind": "enum",
                  "meaning": "`accepted` when the day is closed and frozen; `live` when it is still being read.",
                  "values": [
                    "accepted",
                    "live"
                  ]
                },
                "cashTaken": {
                  "kind": "money",
                  "meaning": "Cash collected on the day.",
                  "projection": "financial",
                  "valueState": true
                },
                "expenses": {
                  "kind": "money",
                  "meaning": "Expense total for the day.",
                  "projection": "financial",
                  "valueState": true
                },
                "isPriorBoundary": {
                  "kind": "boolean",
                  "meaning": "True for the prior week's comparison day."
                },
                "operatingDate": {
                  "kind": "operatingDate",
                  "meaning": "The day."
                },
                "revenue": {
                  "kind": "money",
                  "meaning": "Sales total for the day.",
                  "projection": "financial",
                  "valueState": true
                },
                "transactionCount": {
                  "kind": "integer",
                  "meaning": "Completed transactions on the day."
                }
              },
              "kind": "object",
              "meaning": "One day's metrics and the authority behind them."
            },
            "kind": "array",
            "maxItems": 8,
            "meaning": "One entry per day in the week plus the prior boundary day."
          },
          "priorBoundaryOperatingDate": {
            "kind": "operatingDate",
            "meaning": "The prior week's boundary day, for a week-over-week comparison."
          },
          "weekEndOperatingDate": {
            "kind": "operatingDate",
            "meaning": "Last operating date of the reported week."
          },
          "weekStartOperatingDate": {
            "kind": "operatingDate",
            "meaning": "First operating date of the reported week."
          }
        }
      },
      "scope": {
        "kind": "store"
      }
    },
    "cap_synthetic_directory_teams": {
      "capabilityId": "cap_synthetic_directory_teams",
      "citation": {
        "rule": "Cite team refs.",
        "sourceRefKinds": [
          "directory_team"
        ]
      },
      "completeness": {
        "rule": "Complete once the single page is consumed.",
        "sourceKeys": [
          "pages"
        ]
      },
      "contractVersion": 1,
      "cost": {
        "worstCasePerCall": {
          "bytes": 65536,
          "calls": 1,
          "costUnits": 2,
          "elapsedMs": 1500,
          "rows": 50
        }
      },
      "egressClass": "operational",
      "evidence": {
        "mode": "provenance_only",
        "reason": "Directory rows are references."
      },
      "examples": [
        {
          "args": {
            "role": "managers"
          },
          "description": "Manager teams.",
          "title": "Managers",
          "verb": "list"
        }
      ],
      "freshness": {
        "authority": "live_read",
        "classes": [
          "live"
        ],
        "rule": "Live directory."
      },
      "lifecycle": "enabled",
      "namespace": {
        "package": "directory",
        "resource": "teams"
      },
      "operations": {
        "list": {
          "bounds": {
            "kind": "collection",
            "maxItemsPerPage": 50,
            "maxPagesPerRun": 1
          },
          "filters": {
            "role": {
              "kind": "enum",
              "meaning": "Role partition.",
              "required": false,
              "values": [
                "managers",
                "cashiers",
                "support"
              ]
            }
          },
          "purpose": "Page through teams."
        }
      },
      "packageVersion": "1.0.0",
      "projections": {},
      "purpose": "Teams across the organization and their headcount.",
      "result": {
        "fields": {
          "memberCount": {
            "kind": "integer",
            "meaning": "Active members."
          },
          "name": {
            "kind": "string",
            "meaning": "Team name."
          },
          "teamRef": {
            "kind": "opaqueRef",
            "meaning": "Opaque team ref.",
            "refKind": "resource"
          }
        }
      },
      "scope": {
        "kind": "organization"
      }
    },
    "cap_synthetic_fleet_store_health": {
      "capabilityId": "cap_synthetic_fleet_store_health",
      "citation": {
        "rule": "Cite the sample window hash and incident refs.",
        "sourceRefKinds": [
          "health_sample_window",
          "incident"
        ]
      },
      "completeness": {
        "rule": "Both the sample window and incident feed must be covered.",
        "sourceKeys": [
          "samples",
          "incidents"
        ]
      },
      "contractVersion": 1,
      "cost": {
        "worstCasePerCall": {
          "bytes": 8192,
          "calls": 1,
          "costUnits": 1,
          "elapsedMs": 800,
          "rows": 1
        }
      },
      "egressClass": "operational",
      "evidence": {
        "claimShapes": [
          "uptimePercent"
        ],
        "extractorKey": "fleet.storeHealth",
        "extractorVersion": "1",
        "mode": "extractor"
      },
      "examples": [
        {
          "args": {
            "storeRef": "resource:store-7"
          },
          "description": "One store.",
          "title": "Store health",
          "verb": "get"
        }
      ],
      "freshness": {
        "authority": "derived",
        "classes": [
          "live",
          "derived"
        ],
        "rule": "Uptime is derived from health samples; incident refs are live."
      },
      "lifecycle": "enabled",
      "namespace": {
        "package": "fleet",
        "resource": "storeHealth"
      },
      "operations": {
        "get": {
          "bounds": {
            "kind": "snapshot"
          },
          "filters": {
            "storeRef": {
              "kind": "opaqueRef",
              "meaning": "Opaque store ref.",
              "refKind": "resource",
              "required": true
            }
          },
          "purpose": "One health snapshot for a store."
        }
      },
      "packageVersion": "1.0.0",
      "projections": {
        "incidentDetails": {
          "egressClass": "sensitive",
          "meaning": "Incident review notes, full admins with platform health access only.",
          "requires": {
            "tier": "full_admin"
          }
        }
      },
      "purpose": "One store's health snapshot: uptime, last incident, and review notes.",
      "result": {
        "fields": {
          "incidentNotes": {
            "kind": "text",
            "meaning": "Incident review notes.",
            "projection": "incidentDetails",
            "valueState": true
          },
          "lastIncidentRef": {
            "kind": "opaqueRef",
            "meaning": "Most recent incident.",
            "optional": true,
            "refKind": "source"
          },
          "storeRef": {
            "kind": "opaqueRef",
            "meaning": "Opaque store ref.",
            "refKind": "resource"
          },
          "uptimePercent": {
            "kind": "percentage",
            "meaning": "Uptime over the trailing week."
          }
        }
      },
      "scope": {
        "kind": "organization"
      }
    },
    "cap_synthetic_fleet_stores": {
      "capabilityId": "cap_synthetic_fleet_stores",
      "citation": {
        "rule": "Cite store refs and capture time.",
        "sourceRefKinds": [
          "fleet_store"
        ]
      },
      "completeness": {
        "rule": "Complete once every page is consumed.",
        "sourceKeys": [
          "pages"
        ]
      },
      "contractVersion": 1,
      "cost": {
        "worstCasePerCall": {
          "bytes": 65536,
          "calls": 1,
          "costUnits": 2,
          "elapsedMs": 1500,
          "rows": 50
        }
      },
      "egressClass": "operational",
      "evidence": {
        "mode": "provenance_only",
        "reason": "Roster rows are references."
      },
      "examples": [
        {
          "args": {
            "health": "degraded"
          },
          "description": "Stores needing attention.",
          "title": "Degraded stores",
          "verb": "list"
        }
      ],
      "freshness": {
        "authority": "live_read",
        "classes": [
          "live"
        ],
        "rule": "Live organization roster."
      },
      "lifecycle": "enabled",
      "namespace": {
        "package": "fleet",
        "resource": "stores"
      },
      "operations": {
        "list": {
          "bounds": {
            "kind": "collection",
            "maxItemsPerPage": 50,
            "maxPagesPerRun": 2
          },
          "filters": {
            "health": {
              "kind": "enum",
              "meaning": "Health band partition.",
              "required": false,
              "values": [
                "healthy",
                "degraded",
                "offline"
              ]
            },
            "region": {
              "kind": "string",
              "meaning": "Narrow to stores whose governing IANA timezone identifier matches (e.g. \"Africa/Accra\").",
              "required": false
            }
          },
          "purpose": "Page through the organization's stores."
        }
      },
      "packageVersion": "1.0.0",
      "projections": {},
      "purpose": "Stores in the organization with their current health band.",
      "result": {
        "fields": {
          "health": {
            "kind": "enum",
            "meaning": "Current health band.",
            "values": [
              "healthy",
              "degraded",
              "offline"
            ]
          },
          "name": {
            "kind": "string",
            "meaning": "Store display name."
          },
          "region": {
            "kind": "string",
            "meaning": "The store's governing IANA timezone identifier."
          },
          "storeRef": {
            "kind": "opaqueRef",
            "meaning": "Opaque store ref.",
            "refKind": "resource"
          }
        }
      },
      "scope": {
        "kind": "organization"
      }
    }
  },
  "namespaceIndex": {
    "automation.dailyOperations": "cap_dailyops_automation",
    "cash.registerSessions": "cap_dailyops_register_sessions",
    "directory.teams": "cap_synthetic_directory_teams",
    "fleet.storeHealth": "cap_synthetic_fleet_store_health",
    "fleet.stores": "cap_synthetic_fleet_stores",
    "inventory.positions": "cap_dailyops_inventory_positions",
    "inventory.replenishment": "cap_dailyops_replenishment",
    "operations.activity": "cap_dailyops_activity",
    "operations.approvals": "cap_dailyops_approvals",
    "operations.attention": "cap_dailyops_attention",
    "operations.storeDay": "cap_dailyops_store_day",
    "reports.daySales": "cap_dailyops_day_sales",
    "reports.storePulse": "cap_dailyops_store_pulse",
    "reports.weekPerformance": "cap_dailyops_week_performance"
  },
  "packageIndex": {
    "cap_dailyops_activity": "operations",
    "cap_dailyops_approvals": "operations",
    "cap_dailyops_attention": "operations",
    "cap_dailyops_automation": "automation",
    "cap_dailyops_day_sales": "reports",
    "cap_dailyops_inventory_positions": "inventory",
    "cap_dailyops_register_sessions": "cash",
    "cap_dailyops_replenishment": "inventory",
    "cap_dailyops_store_day": "operations",
    "cap_dailyops_store_pulse": "reports",
    "cap_dailyops_week_performance": "reports",
    "cap_synthetic_directory_teams": "directory",
    "cap_synthetic_fleet_store_health": "fleet",
    "cap_synthetic_fleet_stores": "fleet"
  },
  "summaries": {
    "cap_dailyops_activity": {
      "capabilityId": "cap_dailyops_activity",
      "namespace": "operations.activity",
      "purpose": "What happened on an operating day, newest first, normalized across operational source families.",
      "scopeKind": "store",
      "verbs": [
        "list"
      ]
    },
    "cap_dailyops_approvals": {
      "capabilityId": "cap_dailyops_approvals",
      "namespace": "operations.approvals",
      "purpose": "Approval requests still awaiting a decision on an operating day.",
      "scopeKind": "store",
      "verbs": [
        "list"
      ]
    },
    "cap_dailyops_attention": {
      "capabilityId": "cap_dailyops_attention",
      "namespace": "operations.attention",
      "purpose": "Items on an operating day that need an operator, with the lane each one came from.",
      "scopeKind": "store",
      "verbs": [
        "list"
      ]
    },
    "cap_dailyops_automation": {
      "capabilityId": "cap_dailyops_automation",
      "namespace": "automation.dailyOperations",
      "purpose": "What Athena's Daily Operations automation did on an operating day, and under which policy.",
      "scopeKind": "store",
      "verbs": [
        "list"
      ]
    },
    "cap_dailyops_day_sales": {
      "capabilityId": "cap_dailyops_day_sales",
      "namespace": "reports.daySales",
      "purpose": "One operating day of sales: volume, revenue, payment groups, and the top items behind them.",
      "scopeKind": "store",
      "verbs": [
        "get"
      ]
    },
    "cap_dailyops_inventory_positions": {
      "capabilityId": "cap_dailyops_inventory_positions",
      "namespace": "inventory.positions",
      "purpose": "Live stock position for the store's sellable SKUs.",
      "scopeKind": "store",
      "verbs": [
        "get",
        "list"
      ]
    },
    "cap_dailyops_register_sessions": {
      "capabilityId": "cap_dailyops_register_sessions",
      "namespace": "cash.registerSessions",
      "purpose": "Register (drawer) sessions for an operating day and the closeout state of each one.",
      "scopeKind": "store",
      "verbs": [
        "get",
        "list"
      ]
    },
    "cap_dailyops_replenishment": {
      "capabilityId": "cap_dailyops_replenishment",
      "namespace": "inventory.replenishment",
      "purpose": "Replenishment recommendations derived from stock pressure and purchase-order coverage.",
      "scopeKind": "store",
      "verbs": [
        "list"
      ]
    },
    "cap_dailyops_store_day": {
      "capabilityId": "cap_dailyops_store_day",
      "namespace": "operations.storeDay",
      "purpose": "Store-day lifecycle, readiness, and close state for one operating date, with the accepted opening and close records that prove it.",
      "scopeKind": "store",
      "verbs": [
        "get"
      ]
    },
    "cap_dailyops_store_pulse": {
      "capabilityId": "cap_dailyops_store_pulse",
      "namespace": "reports.storePulse",
      "purpose": "A bounded trading pulse for today or the current week, with its own comparison window.",
      "scopeKind": "store",
      "verbs": [
        "get"
      ]
    },
    "cap_dailyops_week_performance": {
      "capabilityId": "cap_dailyops_week_performance",
      "namespace": "reports.weekPerformance",
      "purpose": "Seven operating days of performance ending on a chosen day, plus the prior week's boundary day.",
      "scopeKind": "store",
      "verbs": [
        "get"
      ]
    },
    "cap_synthetic_directory_teams": {
      "capabilityId": "cap_synthetic_directory_teams",
      "namespace": "directory.teams",
      "purpose": "Teams across the organization and their headcount.",
      "scopeKind": "organization",
      "verbs": [
        "list"
      ]
    },
    "cap_synthetic_fleet_store_health": {
      "capabilityId": "cap_synthetic_fleet_store_health",
      "namespace": "fleet.storeHealth",
      "purpose": "One store's health snapshot: uptime, last incident, and review notes.",
      "scopeKind": "organization",
      "verbs": [
        "get"
      ]
    },
    "cap_synthetic_fleet_stores": {
      "capabilityId": "cap_synthetic_fleet_stores",
      "namespace": "fleet.stores",
      "purpose": "Stores in the organization with their current health band.",
      "scopeKind": "organization",
      "verbs": [
        "list"
      ]
    }
  }
};
// #endregion AGENT_GENERATED_SCHEMAS_JSON


/** Identity of the model-visible schema set; changes whenever a declaration changes. */
export const AGENT_GENERATED_SCHEMAS_DIGEST = "fnv1a64:49a4a969924e44b4";
