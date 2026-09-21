/**
 * The server version, read from package.json rather than duplicated in code so
 * that a release bump cannot drift from what the self-check reports.
 *
 * `require` (not `import`) keeps package.json out of the TypeScript program:
 * from `dist/version.js` the relative path resolves to the package.json the
 * bundle copies next to `dist/`, and from `src/` under vitest it resolves to
 * the repository's own package.json.
 */
function readVersion(): string {
  try {
    const pkg = require("../package.json") as { version?: unknown };
    return typeof pkg.version === "string" && pkg.version.trim() !== "" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const VERSION: string = readVersion();
