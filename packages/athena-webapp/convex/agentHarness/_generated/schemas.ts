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
              "meaning": "Region label to narrow by.",
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
            "meaning": "Region label."
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
    "directory.teams": "cap_synthetic_directory_teams",
    "fleet.storeHealth": "cap_synthetic_fleet_store_health",
    "fleet.stores": "cap_synthetic_fleet_stores"
  },
  "packageIndex": {
    "cap_synthetic_directory_teams": "directory",
    "cap_synthetic_fleet_store_health": "fleet",
    "cap_synthetic_fleet_stores": "fleet"
  },
  "summaries": {
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
export const AGENT_GENERATED_SCHEMAS_DIGEST = "fnv1a64:ae1cf7b1f982d3d5";
