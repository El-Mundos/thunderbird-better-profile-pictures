/**
 * Shares domain-provider lookups across the correspondents of one session.
 *
 * Two addresses at the same domain need the same BIMI record and the same
 * favicon. Looked up separately, they cost the same requests twice when they
 * are on screen together, and every subdomain of a parent repeats the
 * parent's lookup (each of *.gouv.fr asked for gouv.fr). A lookup in flight
 * is therefore shared by whoever asks for the same provider and domain, and
 * a miss is remembered for as long as the not-found cache lifetime.
 *
 * Only misses are kept once settled: a picture found is already saved to the
 * on-disk cache, which later lookups read first. A lookup that fails, rather
 * than finding nothing, is not remembered, so a network error is retried.
 */
export default class DomainLookups {
  /**
   * @param {number} [maxEntries=1000] - Cap on remembered misses.
   */
  constructor(maxEntries = 1000) {
    this.maxEntries = maxEntries;
    /** @type {Map<string, Promise<Blob|null>>} */
    this.pending = new Map();
    /** @type {Map<string, number>} key -> when the miss was recorded */
    this.misses = new Map();
  }

  /**
   * Runs a lookup unless the same one is in flight or recently missed.
   * @param {string} key - Provider and domain, e.g. "bimi:gouv.fr".
   * @param {function(): Promise<Blob|null>} lookup - Resolves to the picture
   *   or null for a miss; rejects on failure.
   * @param {number} missLifetimeMs - How long a miss holds; 0 for ever.
   * @returns {Promise<Blob|null>}
   */
  run(key, lookup, missLifetimeMs) {
    const missedAt = this.misses.get(key);
    if (missedAt !== undefined) {
      if (missLifetimeMs <= 0 || Date.now() - missedAt <= missLifetimeMs) {
        return Promise.resolve(null);
      }
      this.misses.delete(key);
    }
    if (this.pending.has(key)) {
      return this.pending.get(key);
    }
    const promise = (async () => lookup())()
      .then((result) => {
        if (!result && this.pending.get(key) === promise) {
          if (this.misses.size >= this.maxEntries) {
            this.misses.delete(this.misses.keys().next().value);
          }
          this.misses.set(key, Date.now());
        }
        return result;
      })
      .finally(() => {
        if (this.pending.get(key) === promise) {
          this.pending.delete(key);
        }
      });
    this.pending.set(key, promise);
    return promise;
  }

  /**
   * Forgets everything: after a cache clear or a settings change, lookups
   * start afresh. Lookups already in flight finish but are not remembered.
   */
  clear() {
    this.pending.clear();
    this.misses.clear();
  }
}

/** The instance shared by every fetcher in the background page. */
export const domainLookups = new DomainLookups();
