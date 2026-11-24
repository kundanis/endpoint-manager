import { normalizeFeatures } from "@license/shared";

// The JSON stored for a key's features: null when the list includes everything in its modules.
export function storedFeatures(modules: string[], features: string[] | null | undefined): string | null {
  const list = normalizeFeatures(modules, features);
  return list === null ? null : JSON.stringify(list);
}
