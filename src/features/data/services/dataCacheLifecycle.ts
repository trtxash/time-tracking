import { clearDataBootstrapSnapshot } from "./dataBootstrapSnapshot.ts";
import { clearDataReadModelCache } from "./dataReadModel.ts";
import { clearDataTrendSnapshotCache } from "./dataTrendSnapshot.ts";

export function clearDataHeavyCaches(): void {
  clearDataReadModelCache();
  clearDataTrendSnapshotCache();
}

export function clearDataBootstrapCache(): Promise<void> {
  return clearDataBootstrapSnapshot();
}
