---
title: Athena R2 Integrations Must Validate Env Before SDK Clients
date: 2026-04-29
category: logic-errors
module: athena-webapp
problem_type: configuration_error
component: cloudflare-r2
symptoms:
  - "Production SKU image uploads failed with AWS SDK error: Resolved credential object is not valid"
  - "Development uploads worked because local R2 env values were configured"
  - "The upload action could return success with an empty image URL list after R2 failures"
root_cause: missing_or_blank_runtime_env
resolution_type: code_fix
severity: high
tags:
  - convex
  - cloudflare-r2
  - aws-sdk
  - environment-variables
  - uploads
---

# Athena R2 Integrations Must Validate Env Before SDK Clients

## Problem

Athena product SKU image uploads use the AWS S3 SDK against Cloudflare R2. In production, missing or blank R2 env values reached `S3Client` as credential fields, producing the opaque SDK error `Resolved credential object is not valid`.

Because the R2 helper constructed the client from top-level `process.env` reads and swallowed upload errors, the failing action did not clearly identify the missing deployment config.

## Solution

Resolve and validate R2 config before creating or reusing the SDK client:

```ts
resolveR2ConfigFromEnv(process.env);
```

The resolver trims values, treats blank strings as missing, and throws a deployment-actionable error listing only env var names:

```text
Missing Cloudflare R2 environment variables: R2_ACCESS_KEY_ID
```

Upload and delete helpers should rethrow SDK failures after logging so Convex actions fail honestly instead of returning success with incomplete R2 side effects.

## Prevention

- Do not pass non-null-asserted `process.env.*` values directly into SDK client constructors.
- Add a small config resolver test for every server-side integration with required credentials.
- Validate missing and blank values; production secret managers can accidentally provide whitespace or unset values.
- Keep error messages secret-safe by naming missing variables, not printing configured values.
- Let action failures propagate when external side effects fail, unless the caller has an explicit compensating path.
