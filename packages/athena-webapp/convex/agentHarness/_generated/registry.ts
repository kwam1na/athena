/**
 * GENERATED FILE — do not edit. Run `bun run agent-sdk:generate`.
 *
 * Privileged agent capability registry.
 *
 * Full manifests, the read-port dispatch binding, profile policy, per-port
 * implementation identity, the published enablement baseline, and the
 * registry/compatibility digests. This module is NEVER model-visible and
 * must not be imported by `convex/agentHarness/discovery.ts` or by any
 * path that renders model context.
 *
 * Registration sources:
 *   - agentHarness/profiles/syntheticSecondSurface
 */

import type { AgentCapabilityRegistry } from "../registry";

// #region AGENT_GENERATED_REGISTRY_JSON
export const AGENT_GENERATED_REGISTRY: AgentCapabilityRegistry = {
  "capabilities": {
    "cap_synthetic_directory_teams": {
      "binding": {
        "implementationVersion": "1",
        "portKey": "directory.teams",
        "readIntents": [
          "organization.view",
          "staff.view"
        ]
      },
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
      "binding": {
        "implementationVersion": "1",
        "portKey": "fleet.storeHealth",
        "readIntents": [
          "organization.view",
          "platform.health.view"
        ]
      },
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
            "readIntents": [
              "platform.health.view"
            ],
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
      "binding": {
        "implementationVersion": "1",
        "portKey": "fleet.stores",
        "readIntents": [
          "organization.view",
          "store.configuration.view"
        ]
      },
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
  "compatibilityDigest": "fnv1a64:d61d3554e87e7b1e",
  "contractVersion": 1,
  "enablement": {
    "capabilities": {
      "cap_synthetic_directory_teams": "enabled",
      "cap_synthetic_fleet_store_health": "enabled",
      "cap_synthetic_fleet_stores": "enabled"
    },
    "profiles": {
      "organization_overview": "unpublished"
    }
  },
  "namespaces": {
    "directory.teams": "cap_synthetic_directory_teams",
    "fleet.storeHealth": "cap_synthetic_fleet_store_health",
    "fleet.stores": "cap_synthetic_fleet_stores"
  },
  "portByCapability": {
    "cap_synthetic_directory_teams": "directory.teams",
    "cap_synthetic_fleet_store_health": "fleet.storeHealth",
    "cap_synthetic_fleet_stores": "fleet.stores"
  },
  "portImplementations": {
    "directory.teams": {
      "implementationVersion": "1",
      "sourceDigest": "sha256:01ae8ebf10e59c831a4fee4d543aefd0a5e27643e65086080344ed03a4455000"
    },
    "fleet.storeHealth": {
      "implementationVersion": "1",
      "sourceDigest": "sha256:01ae8ebf10e59c831a4fee4d543aefd0a5e27643e65086080344ed03a4455000"
    },
    "fleet.stores": {
      "implementationVersion": "1",
      "sourceDigest": "sha256:01ae8ebf10e59c831a4fee4d543aefd0a5e27643e65086080344ed03a4455000"
    }
  },
  "profiles": {
    "organization_overview": {
      "budgetPolicy": {
        "maxAttempts": 2,
        "maxInFlightCalls": 3,
        "runLimits": {
          "bytes": 524288,
          "calls": 12,
          "costUnits": 120,
          "elapsedMs": 45000,
          "rows": 1000
        }
      },
      "contractVersion": 1,
      "egressPolicy": {
        "maxClass": "sensitive",
        "providers": [
          {
            "maxClass": "sensitive",
            "modelId": "fake-1",
            "providerId": "athena_contract_fake",
            "region": "local"
          }
        ]
      },
      "evaluation": {
        "scenarios": [
          {
            "expects": [
              "fleet.stores",
              "fleet.storeHealth",
              "directory.teams"
            ],
            "id": "fleet_and_teams",
            "kind": "cross_package",
            "prompt": "Which degraded stores have the smallest support teams?"
          },
          {
            "expects": [
              "incidentNotes absent without incidentDetails"
            ],
            "id": "incident_notes_restricted",
            "kind": "role_restricted",
            "prompt": "Show the incident notes for store 7."
          },
          {
            "expects": [
              "no_usable_sources"
            ],
            "id": "unknown_region",
            "kind": "partial_or_no_data",
            "prompt": "How are stores in Atlantis doing?"
          }
        ]
      },
      "lifecycle": "unpublished",
      "packages": [
        {
          "packageKey": "fleet",
          "packageVersion": "1.0.0"
        },
        {
          "packageKey": "directory",
          "packageVersion": "1.0.0"
        }
      ],
      "presentation": {
        "contextBinding": {
          "keys": [
            "organizationRef"
          ],
          "scopeKind": "organization"
        },
        "contractVersion": 1,
        "entry": {
          "label": "Ask Athena about the organization",
          "location": "organization.overview.toolbar"
        },
        "mountMode": "full_screen_sheet",
        "profileId": "organization_overview",
        "starterIntents": [
          {
            "id": "degraded_stores",
            "label": "Which stores are degraded?",
            "prompt": "Which stores are degraded or offline right now, and since when?",
            "requiresPackages": [
              "fleet"
            ]
          }
        ],
        "threadKeyPolicy": {
          "activeTurnPolicy": "block_second_submission",
          "onContextChange": "confirm_before_next_turn",
          "parts": [
            "profileId",
            "organizationRef"
          ]
        }
      },
      "profileId": "organization_overview",
      "profileVersion": "1",
      "promptPolicy": {
        "intent": "Answer bounded read-only questions about the organization's stores and teams.",
        "maxPromptBytes": 8192,
        "maxPromptTokens": 2000,
        "untrustedDataLabel": "retrieved_organization_data"
      },
      "runtimeAdapterKind": "athena_contract_fake",
      "scope": {
        "kind": "organization"
      }
    }
  },
  "protocolVersions": {
    "admissionPolicy": "u4.0",
    "harness": "athena.agent-harness.v1",
    "runtime": "athena.agent-runtime.v1",
    "runtimeAdapter": {
      "adapterKind": "athena_contract_fake",
      "adapterVersion": "fake.1"
    }
  },
  "readPorts": {
    "directory.teams": {
      "capabilityId": "cap_synthetic_directory_teams",
      "completenessSourceKeys": [
        "pages"
      ],
      "contractVersion": 1,
      "declaredCost": {
        "bytes": 65536,
        "calls": 1,
        "costUnits": 2,
        "elapsedMs": 1500,
        "rows": 50
      },
      "handler": {
        "functionPath": "agentHarness/profiles/syntheticSecondSurfacePorts:listTeams",
        "kind": "internal_query"
      },
      "implementationVersion": "1",
      "portKey": "directory.teams",
      "projections": [],
      "readIntents": [
        "organization.view",
        "staff.view"
      ],
      "scopeKind": "organization",
      "verbs": [
        "list"
      ]
    },
    "fleet.storeHealth": {
      "capabilityId": "cap_synthetic_fleet_store_health",
      "completenessSourceKeys": [
        "samples",
        "incidents"
      ],
      "contractVersion": 1,
      "declaredCost": {
        "bytes": 8192,
        "calls": 1,
        "costUnits": 1,
        "elapsedMs": 800,
        "rows": 1
      },
      "handler": {
        "functionPath": "agentHarness/profiles/syntheticSecondSurfacePorts:getStoreHealth",
        "kind": "internal_query"
      },
      "implementationVersion": "1",
      "portKey": "fleet.storeHealth",
      "projections": [
        "incidentDetails"
      ],
      "readIntents": [
        "organization.view",
        "platform.health.view"
      ],
      "scopeKind": "organization",
      "verbs": [
        "get"
      ]
    },
    "fleet.stores": {
      "capabilityId": "cap_synthetic_fleet_stores",
      "completenessSourceKeys": [
        "pages"
      ],
      "contractVersion": 1,
      "declaredCost": {
        "bytes": 65536,
        "calls": 1,
        "costUnits": 2,
        "elapsedMs": 1500,
        "rows": 50
      },
      "handler": {
        "functionPath": "agentHarness/profiles/syntheticSecondSurfacePorts:listStores",
        "kind": "internal_query"
      },
      "implementationVersion": "1",
      "portKey": "fleet.stores",
      "projections": [],
      "readIntents": [
        "organization.view",
        "store.configuration.view"
      ],
      "scopeKind": "organization",
      "verbs": [
        "list"
      ]
    }
  },
  "registryDigest": "fnv1a64:09474972f7b32191",
  "sdkView": {
    "contractVersion": 1,
    "packages": {
      "directory": {
        "resources": {
          "teams": {
            "capabilityId": "cap_synthetic_directory_teams",
            "scopeKind": "organization",
            "verbs": [
              "list"
            ]
          }
        },
        "version": "1.0.0"
      },
      "fleet": {
        "resources": {
          "storeHealth": {
            "capabilityId": "cap_synthetic_fleet_store_health",
            "scopeKind": "organization",
            "verbs": [
              "get"
            ]
          },
          "stores": {
            "capabilityId": "cap_synthetic_fleet_stores",
            "scopeKind": "organization",
            "verbs": [
              "list"
            ]
          }
        },
        "version": "1.0.0"
      }
    }
  }
};
// #endregion AGENT_GENERATED_REGISTRY_JSON


export const AGENT_GENERATED_SOURCE_KEYS: readonly string[] = [
  "agentHarness/profiles/syntheticSecondSurface"
];

/** What a run pins; U7 compares it with the durable epoch digest. */
export const AGENT_GENERATED_COMPATIBILITY_DIGEST = "fnv1a64:d61d3554e87e7b1e";

/** Schema identity only; unchanged when a capability is enabled or disabled. */
export const AGENT_GENERATED_REGISTRY_DIGEST = "fnv1a64:09474972f7b32191";
