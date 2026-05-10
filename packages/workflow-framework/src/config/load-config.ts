import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { DevexConfigSchema, type DevexConfig } from "./devex-config.schema.js";

/**
 * Loads and validates a `devex.yaml` file from the given path.
 *
 * The file content is parsed as YAML and then validated against the Zod schema.
 * Throws a `ZodError` with detailed field-level messages if validation fails,
 * or an `Error` if the file cannot be read or parsed.
 *
 * @param configPath - Absolute or relative path to devex.yaml (default: "devex.yaml")
 * @returns Validated DevexConfig object with all defaults applied
 */
export function loadConfig(configPath: string = "devex.yaml"): DevexConfig {
  const absolutePath = resolve(configPath);
  let raw: unknown;

  try {
    const content = readFileSync(absolutePath, "utf-8");
    raw = parseYaml(content);
  } catch (readErr) {
    throw new Error(
      `Could not read devex config at "${absolutePath}": ${(readErr as Error).message}`
    );
  }

  return DevexConfigSchema.parse(raw);
}

/**
 * Like `loadConfig` but returns a discriminated result instead of throwing.
 * Useful in scripts that want to report errors without try/catch.
 */
export function tryLoadConfig(
  configPath: string = "devex.yaml"
): { success: true; config: DevexConfig } | { success: false; error: Error } {
  try {
    const config = loadConfig(configPath);
    return { success: true, config };
  } catch (err) {
    return { success: false, error: err as Error };
  }
}
