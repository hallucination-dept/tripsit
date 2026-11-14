export function selectedAfterReload<T extends { id: string }>(selected: T | null, items: T[]): T | null {
  return selected ? items.find(item => item.id === selected.id) ?? null : null;
}
