/** The hook owns bounded logs/heartbeats; the product verifies current admission. */
import { runDeliveryProduct } from "./delivery-product";
export const runPrePushReview = (rootDir: string) => runDeliveryProduct(["verify"], rootDir);
if (import.meta.main) process.exitCode = await runPrePushReview(process.cwd());
