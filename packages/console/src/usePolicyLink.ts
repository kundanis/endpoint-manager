import { useState } from "react";
import { useSearchParams } from "react-router-dom";

// A policy page's selected policy, starting with the one a link names (?policy=<id>), e.g. from an
// endpoint's Applied Policies card.
export function useLinkedPolicySelection() {
  const [params] = useSearchParams();
  return useState<string | undefined>(() => params.get("policy") ?? undefined);
}
