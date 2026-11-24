import { z } from "zod";

// Licensing below the module (Module -> Sub-module -> Feature): the catalogue and its rules are
// in featureCatalog.ts; this adds the wire schema.
export * from "./featureCatalog";

// On the wire: the feature list, or null for "everything in the licensed modules".
export const licenseFeatureListSchema = z.array(z.string().min(1).max(40)).max(200).nullable();
