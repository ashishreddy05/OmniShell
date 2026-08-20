const DEBUG_ENABLED = process.env.DEBUG?.split(",").includes("ssh") || process.env.DEBUG === "*";

export function debugLog(...args: unknown[]) {
  if (DEBUG_ENABLED) {
    console.log("[DEBUG]", ...args);
  }
}

export function debugWarn(...args: unknown[]) {
  if (DEBUG_ENABLED) {
    console.warn("[DEBUG]", ...args);
  }
}

export function debugError(...args: unknown[]) {
  // Errors are always logged
  console.error(...args);
}
