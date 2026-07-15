type RepairCommand = "amend" | "create" | "resume";

type ParsedRepairArgs = {
  command: RepairCommand;
  payload: Record<string, string>;
};

function requireValue(flags: Map<string, string>, name: string) {
  const value = flags.get(name)?.trim();
  if (!value) throw new Error(`Missing required --${name}.`);
  return value;
}

export function parseOperationalWorkRepairArgs(argv: string[]): ParsedRepairArgs {
  const [commandValue, ...rest] = argv;
  if (
    commandValue !== "create" &&
    commandValue !== "amend" &&
    commandValue !== "resume"
  ) {
    throw new Error("Command must be create, amend, or resume.");
  }
  const flags = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid argument near ${flag ?? "end of command"}.`);
    }
    flags.set(flag.slice(2), value);
  }
  const evidence = {
    initiatorIdentifier: requireValue(flags, "initiator"),
    reason: requireValue(flags, "reason"),
    supportTicket: requireValue(flags, "support-ticket"),
  };
  if (commandValue === "create") {
    return {
      command: commandValue,
      payload: {
        ...evidence,
        groupKey: requireValue(flags, "group-key"),
        organizationId: requireValue(flags, "organization-id"),
        storeId: requireValue(flags, "store-id"),
      },
    };
  }
  return {
    command: commandValue,
    payload: {
      ...evidence,
      repairId: requireValue(flags, "repair-id"),
    },
  };
}

export function buildOperationalWorkRepairInvocation(args: ParsedRepairArgs) {
  const functionName =
    args.command === "create"
      ? "createRepair"
      : args.command === "amend"
        ? "amendRepair"
        : "resumeRepair";
  return [
    "bunx",
    "convex",
    "run",
    `operations/oversizedOperationalWorkRepair:${functionName}`,
    JSON.stringify(args.payload),
  ];
}

async function main() {
  if (!process.env.CONVEX_DEPLOY_KEY) {
    throw new Error(
      "CONVEX_DEPLOY_KEY is required; oversized repair is support-only.",
    );
  }
  const invocation = buildOperationalWorkRepairInvocation(
    parseOperationalWorkRepairArgs(process.argv.slice(2)),
  );
  const child = Bun.spawn(invocation, {
    cwd: new URL("../packages/athena-webapp", import.meta.url).pathname,
    stderr: "inherit",
    stdin: "inherit",
    stdout: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) process.exit(exitCode);
}

if (import.meta.main) {
  await main();
}
