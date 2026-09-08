/** The portable delivery record replaces Athena's private pre-push proof. */
import { runDeliveryProduct } from "./delivery-product";
if (import.meta.main) process.exitCode = await runDeliveryProduct(["verify", ...Bun.argv.slice(2)]);
