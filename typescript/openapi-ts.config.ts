import { defineConfig } from '@hey-api/openapi-ts'

/**
 * Generates the TypeScript client from the same versioned spec surface the
 * Kotlin client is built from, by way of the same generator-fixup step — so the
 * two published artefacts describe an identical API and share one version.
 *
 * `../build/ts-generator-input.json` is produced by
 * `tools/src/cli.mjs generator-input`, which the `generate` script runs first.
 */
export default defineConfig({
  input: '../build/ts-generator-input.json',
  output: {
    path: 'src/generated',
    // No formatting or lint pass: the generated tree is committed, and a
    // formatter in the loop makes the nightly spec diff depend on a
    // devDependency's version rather than on what upstream actually changed.
    postProcess: [],
  },
  plugins: [
    { name: '@hey-api/typescript', enums: 'typescript' },
    // Axios rather than fetch: the primary consumer (ESA-Blueshell/website)
    // already routes every call through axios interceptors for auth and error
    // reporting, and a client it cannot plug into those is a client it will not
    // adopt. Declared as a peer dependency so the consumer pins the version.
    { name: '@hey-api/client-axios' },
    {
      name: '@hey-api/sdk',
      // Flat, individually-exported functions rather than a single Sdk class:
      // they tree-shake, so a consumer importing one operation does not pull
      // in all seven, and they match the call style the website already uses.
      operations: { strategy: 'flat' },
      paramsStructure: 'grouped',
    },
  ],
})
