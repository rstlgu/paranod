// Selection is presentation state, not a graph mutation. Keep this path narrow
// so browsing a leased graph cannot change positions, contents or membership.
export function updateGraphSelection<T extends { selected?: boolean }>(
  items: T[],
  selected: (item: T) => boolean
): T[] {
  let changed = false;
  const next = items.map((item) => {
    const value = selected(item);
    if (Boolean(item.selected) === value) return item;
    changed = true;
    return { ...item, selected: value };
  });
  return changed ? next : items;
}
