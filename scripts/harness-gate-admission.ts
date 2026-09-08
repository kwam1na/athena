/** Familiar Athena alias; admission and every evidence decision belong to the product. */
import { runDeliveryProduct } from "./delivery-product";
if (import.meta.main) process.exitCode = await runDeliveryProduct(["gate", ...Bun.argv.slice(2)]);
