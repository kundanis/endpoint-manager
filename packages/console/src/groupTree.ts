// Group hierarchy in the console (Main group -> sub group -> ..., any depth). The server applies
// a group's policies to every group below it and its filters include the groups below; these
// helpers do the same for lists filtered in the browser.

interface TreeGroup {
  id: string;
  parentId?: string | null;
}

// The groups and every group below them (each included).
export function groupsBelow(groups: TreeGroup[] | undefined, ids: Iterable<string>): Set<string> {
  const children = new Map<string, string[]>();
  for (const g of groups ?? []) if (g.parentId) children.set(g.parentId, [...(children.get(g.parentId) ?? []), g.id]);
  const out = new Set<string>();
  const queue = [...ids];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    queue.push(...(children.get(id) ?? []));
  }
  return out;
}

// How deep a group sits: 0 for a main group ("Mumbai"), 1 for "Mumbai › Andheri"...
export function groupDepth(path: string | undefined): number {
  return path ? path.split(" › ").length - 1 : 0;
}
