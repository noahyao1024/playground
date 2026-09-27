/** A path on this site to land on -- after signing in, say -- or else the
 *  fallback. Never another origin: not "https://…", not "//host", and no
 *  backslash, which some browsers read as a slash. */
export function sameSitePath(value: unknown, fallback: string): string {
  return typeof value === "string" && /^\/(?![/\\])[^\\\s]*$/.test(value) ? value : fallback;
}
