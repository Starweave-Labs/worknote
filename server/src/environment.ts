/** Shared environment loading for the API and CLIs. No machine-wide files are read implicitly. */
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function loadEnvironment(): void {
  const configured = process.env.WORKNOTE_ENV_FILE;
  // An empty value explicitly disables file loading, useful for isolated tests.
  if (configured === "") return;
  const file = configured ? resolve(configured) : resolve(sourceRoot, ".env");
  if (!existsSync(file)) {
    if (configured) throw new Error(`Environment file does not exist: ${file}`);
    return;
  }
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = raw.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    const value = match[2];
    if (value.startsWith('"') && value.endsWith('"')) {
      process.env[match[1]] = value.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    } else if (value.startsWith("'") && value.endsWith("'")) {
      process.env[match[1]] = value.slice(1, -1);
    } else {
      process.env[match[1]] = value.replace(/\s+#.*$/, "").trim();
    }
  }
}

loadEnvironment();

/** Relative data directories are resolved against the source root, independent of the working directory. */
export function dataRoot(): string {
  const value = process.env.WORKNOTE_ROOT || "data";
  return isAbsolute(value) ? resolve(value) : resolve(sourceRoot, value);
}
