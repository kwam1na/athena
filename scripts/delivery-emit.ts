/** Compatibility entry point: run observation is owned by the installed product. */
import { runDeliveryProduct } from "./delivery-product";
if (import.meta.main) process.exitCode = await runDeliveryProduct(["emit", ...Bun.argv.slice(2)]);
