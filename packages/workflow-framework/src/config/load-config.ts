import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DevexConfigSchema, type DevexConfig } from "./devex-config.schema.js";

/**
 * Loads and parses a devex.yaml file from the given path.
 * Throws a ZodError with detailed field-level messages if the file is invalid.
 *
 * @param configPath - Absolute or relative path to devex.yaml
 * @returns Validated DevexConfig object with all defaults applied
 */
export function loadConfig(configPath: string = "devex.yaml"): DevexConfig {
  const absolutePath = resolve(configPath);
  let raw: unknown;

  try {
    const content = readFileSync(absolutePath, "utf-8");
    // NOTE: The workflow framework intentionally keeps zero YAML parsing
    // dependencies at this layer. Real YAML parsing (with full spec compliance)
    // is handled by the CLI layer (Python: pyyaml / Node: js-yaml).
    // For unit tests and programmatic use, callers should parse YAML themselves
    // and pass the resulting plain object to `assertValidConfig` instead.
    // This function accepts a pre-parsed JSON file or plain JS object serialised
    // as JSON for testing purposes.
    raw = JSON.parse(content);
  } catch (readErr) {
    throw new Error(
      `Could not read devex config at "${absolutePath}": ${(readErr as Error).message}`
    );
  }

  return DevexConfigSchema.parse(raw);
}

/**
 * Like loadConfig but returns a discriminated result instead of throwing.
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
