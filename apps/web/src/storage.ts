import { get, set, del } from 'idb-keyval';
import type { WorldSnapshot } from '@living-bugs/sim-core';

const SNAPSHOT_KEY = 'living-bugs-world-snapshot';

export async function saveSnapshot(snapshot: WorldSnapshot): Promise<void> {
  await set(SNAPSHOT_KEY, snapshot);
  console.log(`[Storage] World saved at tick ${snapshot.tick}`);
}

export async function loadSnapshot(): Promise<WorldSnapshot | null> {
  const data = await get<WorldSnapshot>(SNAPSHOT_KEY);
  if (data) {
    console.log(`[Storage] World loaded from tick ${data.tick}`);
    return data;
  }
  return null;
}

export async function clearSnapshot(): Promise<void> {
  await del(SNAPSHOT_KEY);
}
