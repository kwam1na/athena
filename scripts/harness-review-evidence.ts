/** Compatibility command names only; no local manifest conversion or evidence store. */
import { runDeliveryProduct } from "./delivery-product";
export function reviewEvidenceArguments(argv: readonly string[]): string[] {
  const [command, ...args] = argv;
  if (command === "context") return ["review-context", "--json", ...args];
  if (command === "record") return ["submit-evidence", "--manifest", ...args];
  return [...argv];
}
if (import.meta.main) process.exitCode = await runDeliveryProduct(reviewEvidenceArguments(Bun.argv.slice(2)));
