// Runtime version resolution for extension pages and the userscript bundle.
// Extension manifests are authoritative at runtime; the userscript build
// injects the package version before the bundled entry executes.

export function resolveAppVersion(runtime = globalThis) {
  const runtimes = [runtime.chrome?.runtime, runtime.browser?.runtime];
  for (const extensionRuntime of runtimes) {
    if (typeof extensionRuntime?.getManifest !== 'function') continue;
    try {
      const version = extensionRuntime.getManifest()?.version;
      if (typeof version === 'string' && version) return version;
    } catch {
      // Fall through to the build-injected userscript value or dev marker.
    }
  }
  const injected = runtime.__AUT_VERSION__;
  return typeof injected === 'string' && injected ? injected : 'dev';
}

export const APP_VERSION = resolveAppVersion();
