type SerializedValidator =
  | {
      type:
        | "any"
        | "bigint"
        | "boolean"
        | "bytes"
        | "float64"
        | "id"
        | "int64"
        | "null"
        | "number"
        | "string";
      tableName?: string;
    }
  | {
      type: "literal";
      value: unknown;
    }
  | {
      type: "array";
      value: SerializedValidator;
    }
  | {
      type: "object";
      value: Record<
        string,
        {
          fieldType: SerializedValidator;
          optional: boolean;
        }
      >;
    }
  | {
      type: "record";
      keys: SerializedValidator;
      values: {
        fieldType: SerializedValidator;
        optional: boolean;
      };
    }
  | {
      type: "union";
      value: SerializedValidator[];
    };

type ConvexFunctionWithReturns = {
  exportReturns(): string;
};

type ValidationIssue = {
  path: string;
  message: string;
};

const MIN_INT64 = -(1n << 63n);
const MAX_INT64 = (1n << 63n) - 1n;

export function assertConformsToExportedReturns(
  definition: ConvexFunctionWithReturns,
  value: unknown,
) {
  const issues = collectReturnValidatorIssues(
    parseExportedReturnValidator(definition),
    value,
  );

  if (issues.length > 0) {
    throw new Error(formatReturnValidatorIssues(issues));
  }
}

export function collectReturnValidatorIssues(
  validator: SerializedValidator,
  value: unknown,
) {
  return validateValue(validator, value, "$");
}

function parseExportedReturnValidator(definition: ConvexFunctionWithReturns) {
  return JSON.parse(definition.exportReturns()) as SerializedValidator;
}

function validateValue(
  validator: SerializedValidator,
  value: unknown,
  path: string,
): ValidationIssue[] {
  switch (validator.type) {
    case "any":
      return isConvexValue(value)
        ? []
        : [issue(path, `expected Convex value, received ${describeValue(value)}`)];
    case "bigint":
    case "int64":
      return isInt64(value)
        ? []
        : [issue(path, `expected int64 bigint, received ${describeValue(value)}`)];
    case "boolean":
      return typeof value === "boolean"
        ? []
        : [issue(path, `expected boolean, received ${describeValue(value)}`)];
    case "bytes":
      return value instanceof ArrayBuffer
        ? []
        : [
            issue(
              path,
              `expected ArrayBuffer bytes, received ${describeValue(value)}`,
            ),
          ];
    case "float64":
    case "number":
      return typeof value === "number"
        ? []
        : [issue(path, `expected number, received ${describeValue(value)}`)];
    case "id":
    case "string":
      return typeof value === "string"
        ? []
        : [issue(path, `expected string, received ${describeValue(value)}`)];
    case "null":
      return value === null
        ? []
        : [issue(path, `expected null, received ${describeValue(value)}`)];
    case "literal":
      return Object.is(value, decodeSerializedLiteralValue(validator.value))
        ? []
        : [
            issue(
              path,
              `expected literal ${JSON.stringify(validator.value)}, received ${describeValue(value)}`,
            ),
          ];
    case "array":
      return validateArray(validator, value, path);
    case "object":
      return validateObject(validator, value, path);
    case "record":
      return validateRecord(validator, value, path);
    case "union":
      return validateUnion(validator, value, path);
    default:
      return [
        issue(
          path,
          `unsupported serialized validator type ${JSON.stringify((validator as { type?: unknown }).type)}`,
        ),
      ];
  }
}

function validateArray(
  validator: Extract<SerializedValidator, { type: "array" }>,
  value: unknown,
  path: string,
) {
  if (!Array.isArray(value)) {
    return [issue(path, `expected array, received ${describeValue(value)}`)];
  }

  return value.flatMap((entry, index) =>
    validateValue(validator.value, entry, `${path}[${index}]`),
  );
}

function validateObject(
  validator: Extract<SerializedValidator, { type: "object" }>,
  value: unknown,
  path: string,
) {
  if (!isPlainObject(value)) {
    return [issue(path, `expected object, received ${describeValue(value)}`)];
  }

  const issues: ValidationIssue[] = [];
  const record = value as Record<string, unknown>;
  const expectedKeys = new Set(Object.keys(validator.value));

  for (const actualKey of Object.keys(record)) {
    if (!expectedKeys.has(actualKey) && record[actualKey] !== undefined) {
      issues.push(issue(joinPath(path, actualKey), "unexpected field"));
    }
  }

  for (const [key, field] of Object.entries(validator.value)) {
    const childPath = joinPath(path, key);
    const hasValue = Object.prototype.hasOwnProperty.call(record, key);
    if (!hasValue || record[key] === undefined) {
      if (!field.optional) {
        issues.push(issue(childPath, "missing required field"));
      }
      continue;
    }

    issues.push(...validateValue(field.fieldType, record[key], childPath));
  }

  return issues;
}

function validateRecord(
  validator: Extract<SerializedValidator, { type: "record" }>,
  value: unknown,
  path: string,
) {
  if (!isPlainObject(value)) {
    return [issue(path, `expected record, received ${describeValue(value)}`)];
  }

  const issues: ValidationIssue[] = [];
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry === undefined) {
      continue;
    }
    const keyPath = `${path}{${JSON.stringify(key)}}`;
    issues.push(...validateValue(validator.keys, key, keyPath));
    issues.push(
      ...validateValue(validator.values.fieldType, entry, joinPath(path, key)),
    );
  }

  return issues;
}

function validateUnion(
  validator: Extract<SerializedValidator, { type: "union" }>,
  value: unknown,
  path: string,
) {
  const variantIssues = validator.value.map((variant) =>
    validateValue(variant, value, path),
  );
  if (variantIssues.some((issues) => issues.length === 0)) {
    return [];
  }

  return [
    issue(
      path,
      `matched no union variant: ${variantIssues
        .map((issues, index) => `variant ${index + 1}: ${issues[0]?.message}`)
        .join("; ")}`,
    ),
  ];
}

function isPlainObject(value: unknown) {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype &&
    !Array.isArray(value) &&
    !(value instanceof ArrayBuffer)
  );
}

function isConvexValue(value: unknown): boolean {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return true;
  }

  if (typeof value === "bigint") {
    return isInt64(value);
  }

  if (typeof value === "number") {
    return true;
  }

  if (value instanceof ArrayBuffer) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isConvexValue);
  }

  if (!isPlainObject(value)) {
    return false;
  }

  return Object.values(value as Record<string, unknown>).every(
    (entry) => entry === undefined || isConvexValue(entry),
  );
}

function isInt64(value: unknown): value is bigint {
  return typeof value === "bigint" && value >= MIN_INT64 && value <= MAX_INT64;
}

function decodeSerializedLiteralValue(value: unknown) {
  if (
    isPlainObject(value) &&
    typeof (value as { $integer?: unknown }).$integer === "string"
  ) {
    return decodeSerializedInt64((value as { $integer: string }).$integer);
  }

  if (
    isPlainObject(value) &&
    typeof (value as { $float?: unknown }).$float === "string"
  ) {
    return decodeSerializedFloat64((value as { $float: string }).$float);
  }

  return value;
}

function decodeSerializedInt64(encoded: string) {
  const binary = atob(encoded);
  let unsigned = 0n;
  for (let index = 0; index < binary.length; index += 1) {
    unsigned |= BigInt(binary.charCodeAt(index)) << BigInt(index * 8);
  }

  return BigInt.asIntN(64, unsigned);
}

function decodeSerializedFloat64(encoded: string) {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new DataView(bytes.buffer).getFloat64(0, true);
}

function issue(path: string, message: string): ValidationIssue {
  return { path, message };
}

function joinPath(base: string, key: string) {
  return /^[A-Za-z_$][\w$]*$/.test(key)
    ? `${base}.${key}`
    : `${base}[${JSON.stringify(key)}]`;
}

function describeValue(value: unknown) {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (value instanceof ArrayBuffer) {
    return "ArrayBuffer";
  }
  return typeof value;
}

function formatReturnValidatorIssues(issues: ValidationIssue[]) {
  return [
    "Value does not conform to exported Convex return validator:",
    ...issues.map((issue) => `- ${issue.path}: ${issue.message}`),
  ].join("\n");
}
