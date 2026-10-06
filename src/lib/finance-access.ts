/** Existing tokens retain their authority; new ones are read-only by default. */
export const TOKEN_SCOPES = ["housing:read", "finance:read", "finance:write"] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];
export const DEFAULT_TOKEN_SCOPE: TokenScope = "finance:read";
export const scopeLabel: Record<TokenScope, string> = {
  "housing:read": "Housing only · read-only",
  "finance:read": "Finance + housing · read-only",
  "finance:write": "Finance + housing · read and write",
};
export function isTokenScope(value: unknown): value is TokenScope {
  return TOKEN_SCOPES.includes(value as TokenScope);
}
export function permits(scope: TokenScope, resource: "finance" | "housing", write = false) {
  return write ? scope === "finance:write" : resource === "housing" || scope !== "housing:read";
}
