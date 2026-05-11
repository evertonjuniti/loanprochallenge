import type { DevexConfig, AppLanguage } from "../config/devex-config.schema.js";
import type { LanguageAdapter } from "./language-adapter.js";
import { PythonAdapter } from "./python-adapter.js";
import { TypescriptAdapter } from "./typescript-adapter.js";

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Map of all registered language adapters, keyed by AppLanguage.
 *
 * To add support for a new language:
 *   1. Create `src/adapters/<language>-adapter.ts` implementing LanguageAdapter.
 *   2. Import it here and add an entry to ADAPTER_REGISTRY.
 *   3. Export it from `src/index.ts`.
 *   4. Add tests to `test/<language>-adapter.test.ts`.
 */
const ADAPTER_REGISTRY: Partial<Record<AppLanguage, LanguageAdapter>> = {
  python: new PythonAdapter(),
  typescript: new TypescriptAdapter(),
};

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Returns all LanguageAdapters for the given config.
 * When `runtime.appLanguage` is an array (polyglot repo), one adapter is
 * returned per language in declaration order.
 * Throws if any language has no registered adapter.
 */
export function resolveAdapters(config: DevexConfig): LanguageAdapter[] {
  const appLanguage = config.runtime.appLanguage;
  const languages = Array.isArray(appLanguage) ? appLanguage : [appLanguage];
  return languages.map((lang) => {
    const adapter = ADAPTER_REGISTRY[lang];
    if (!adapter) {
      const supported = Object.keys(ADAPTER_REGISTRY).join(", ");
      throw new Error(
        `No language adapter registered for "${lang}". ` +
          `Supported languages: ${supported}. ` +
          `To add support, implement LanguageAdapter and register it in src/adapters/index.ts.`
      );
    }
    return adapter;
  });
}

/**
 * Returns the LanguageAdapter for the given config's `runtime.appLanguage`.
 * Throws a descriptive error if no adapter is registered for that language,
 * which surfaces as an actionable message in both CI and local checks.
 *
 * When `appLanguage` is an array, returns the adapter for the first language.
 * For polyglot repos use `resolveAdapters()` instead.
 *
 * @example
 * const adapter = resolveAdapter(config);
 * const steps = adapter.setupSteps(config);
 */
export function resolveAdapter(config: DevexConfig): LanguageAdapter {
  return resolveAdapters(config)[0]!;
}

/**
 * Returns the list of language names that have a registered adapter.
 * Useful for validation messages and documentation generation.
 */
export function supportedLanguages(): AppLanguage[] {
  return Object.keys(ADAPTER_REGISTRY) as AppLanguage[];
}

export { PythonAdapter, TypescriptAdapter };
export type { LanguageAdapter };
