import type { TokenScope } from "./finance-access";

/** Remove operations outside the token's authority. Analysis/chart POSTs are
 * reads; saving scenarios, refreshing sources and finance actions are writes.
 * Prune unused schemas too so the downloadable Actions contract stays small. */
export function agentOpenApi<T extends { paths: Record<string, unknown>; components: { schemas: Record<string, unknown> }; info: { description: string } }>(document: T, scope: TokenScope, readOnly = false): T {
  const spec = structuredClone(document);
  const readsOnly = readOnly || scope !== "finance:write";
  for (const [path, raw] of Object.entries(spec.paths)) {
    if (scope === "housing:read" && !path.startsWith("/api/housing")) { delete spec.paths[path]; continue; }
    const operations = raw as Record<string, unknown>;
    if (readsOnly && ["/api/finance", "/api/housing"].includes(path)) delete operations.post;
    if (readsOnly) for (const [method, operation] of Object.entries(operations)) {
      if (["get", "post"].includes(method) && operation && typeof operation === "object") Object.assign(operation, { "x-openai-isConsequential": false });
    }
  }
  const keep = new Set<string>();
  function visit(value: unknown) {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== "object") return;
    const obj = value as Record<string, unknown>;
    if (typeof obj.$ref === "string" && obj.$ref.startsWith("#/components/schemas/")) {
      const name = obj.$ref.slice("#/components/schemas/".length);
      if (!keep.has(name)) { keep.add(name); visit(spec.components.schemas[name]); }
    }
    Object.values(obj).forEach(visit);
  }
  visit(spec.paths);
  for (const name of Object.keys(spec.components.schemas)) if (!keep.has(name)) delete spec.components.schemas[name];
  if (readsOnly) spec.info.description = "READ-ONLY CONTRACT. No mutations or external refreshes are exposed. POST analysis/chart are read-only what-ifs.\n\n" + spec.info.description;
  return spec;
}
