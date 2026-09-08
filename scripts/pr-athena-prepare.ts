/** Product preparation runs the mechanical commands declared in Athena config. */
import { runDeliveryProduct } from "./delivery-product";
export const runPrAthenaPreparation = (rootDir: string) => runDeliveryProduct(["prepare"], rootDir);
if (import.meta.main) process.exitCode = await runPrAthenaPreparation(process.cwd());
