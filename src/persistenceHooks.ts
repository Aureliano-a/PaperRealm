const preparers = new Set<() => Promise<void>>();
export function registerWritePreparation(callback: () => Promise<void>) {
  preparers.add(callback);
  return () => {
    preparers.delete(callback);
  };
}
export async function preparePendingWrites() {
  for (const callback of [...preparers]) await callback();
}
