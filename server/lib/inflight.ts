/**
 * Server-side request coalescer.
 *
 * When N concurrent calls ask for the same key (e.g. 6 service-detail polls
 * firing within the same second on the same connection), only ONE backend
 * call is executed. The result is shared with all callers.
 *
 * This is the most effective way to reduce SSH channel pressure on routes
 * that fire many parallel queries against the same connection (e.g.
 * service list + service detail + batch monitor + live monitor all polling
 * at once).
 *
 * The cache TTL (default 1500ms) covers the typical poll cadence so the
 * second poll within the window also hits the coalesced result.
 */
const inflight = new Map<string, Promise<unknown>>();

export function coalesce<T>(
  key: string,
  fn: () => Promise<T>,
  ttlMs = 1500,
): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const p = fn().finally(() => {
    // Use a microtask + setTimeout so the cleanup happens after the current
    // tick — this ensures that requests arriving in the same tick all share
    // the same promise.
    setTimeout(() => {
      // Only delete if it's still the same promise (defensive)
      if (inflight.get(key) === p) inflight.delete(key);
    }, ttlMs);
  });

  inflight.set(key, p);
  return p;
}

/** Clear all coalesced entries. Used by tests or on disconnect. */
export function clearInflight() {
  inflight.clear();
}
