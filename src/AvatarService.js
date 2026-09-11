import SettingsManager from "../settings/SettingsManager.js";
import defaultSettings from "../settings/defaultSettings.js";
import Author from "./Author.js";
import CacheStorage from "./CacheStorage.js";
import ProfilePictureFetcher, { daysToMs } from "./ProfilePictureFetcher.js";

const MAX_CACHE_SIZE = 500;

/**
 * Service for managing avatar URLs.
 */
export default class AvatarService {
  constructor() {
    /**
     * Resolved avatar URLs for the session (Map preserves insertion order for FIFO eviction).
     * @type {Map<string, string|null>}
     */
    this.sessionCacheAvatarUrls = new Map();
    /**
     * In-flight fetch promises keyed by lcAuthor.
     * Concurrent callers for the same author await the same Promise instead of polling.
     * @type {Map<string, Promise<string|null>>}
     */
    this.pendingPromises = new Map();
    this.settingsManager = new SettingsManager(new CacheStorage());
    /**
     * Provider chain, read once and reused. Every avatar lookup needs it, and
     * re-reading it per row would put a storage round-trip on the hot path.
     * Invalidated by refreshSettings when the options page changes it.
     * @type {Array<{id: string, enabled: boolean}>|null}
     */
    this.providerList = null;
    /**
     * Active privacy mode, cached alongside the chain.
     * @type {string|null}
     */
    this.privacyMode = null;
    /**
     * Cache lifetimes in milliseconds, resolved from the day-based settings.
     * @type {{refreshFoundMs: number, refreshNotFoundMs: number}|null}
     */
    this.cacheRefresh = null;
  }

  /**
   * Returns the provider chain, loading it on first use.
   * @returns {Promise<Array<{id: string, enabled: boolean}>>}
   */
  async getProviderList() {
    if (this.providerList === null) {
      try {
        this.providerList = await this.settingsManager.getProviders();
      } catch (error) {
        console.error("Error loading provider settings, using defaults", error);
        this.providerList = defaultSettings.providers;
      }
    }
    return this.providerList;
  }

  /**
   * Returns the active privacy mode, loading it on first use.
   *
   * On a read failure this falls back to the default rather than to the
   * strictest mode. Failing closed would silently stop all lookups and look
   * like the add-on being broken, with no way for the user to tell why.
   * @returns {Promise<string>} A PrivacyMode value.
   */
  /**
   * Returns the cache lifetimes, loading them on first use.
   * @returns {Promise<{refreshFoundMs: number, refreshNotFoundMs: number}>}
   */
  async getCacheRefresh() {
    if (this.cacheRefresh === null) {
      let days;
      try {
        days = await this.settingsManager.getCacheRefreshDays();
      } catch (error) {
        console.error("Error loading cache settings, using defaults", error);
        days = {
          foundDays: defaultSettings.cacheRefreshFoundDays,
          notFoundDays: defaultSettings.cacheRefreshNotFoundDays,
        };
      }
      // Keys match the fetcher's options contract so this can be spread into it.
      this.cacheRefresh = {
        refreshFoundMs: daysToMs(days.foundDays),
        refreshNotFoundMs: daysToMs(days.notFoundDays),
      };
    }
    return this.cacheRefresh;
  }

  async getPrivacyMode() {
    if (this.privacyMode === null) {
      try {
        this.privacyMode = await this.settingsManager.getPrivacyMode();
      } catch (error) {
        console.error("Error loading privacy mode, using default", error);
        this.privacyMode = defaultSettings.privacyMode;
      }
    }
    return this.privacyMode;
  }

  /**
   * Drops the cached provider chain so the next lookup re-reads it, and clears
   * resolved avatars: a chain change can produce a different picture for a
   * correspondent already resolved under the old order.
   *
   * Fetches already in flight were started under the old chain. They are
   * forgotten too, so the next lookup starts afresh, and getAvatar does not
   * cache what they return.
   */
  invalidateSettings() {
    this.providerList = null;
    this.privacyMode = null;
    this.cacheRefresh = null;
    this.sessionCacheAvatarUrls.clear();
    this.pendingPromises.clear();
  }

  /**
   * Returns the number of avatars that are currently being fetched.
   * @returns {number} - The number of avatars being fetched.
   */
  countWaitingAvatars() {
    return this.pendingPromises.size;
  }

  /**
   * Retrieves the avatar URL for the given author.
   *
   * Concurrent calls for the same author share a single in-flight Promise,
   * eliminating the 200 ms polling loop. Resolved results are kept in a
   * FIFO-evicting Map capped at MAX_CACHE_SIZE entries.
   *
   * @param {Author} author - The author for whom to fetch the avatar URL.
   * @returns {Promise<string|null>} - The avatar URL or null if request limit exceeded or not found.
   */
  async getAvatar(author) {
    const lcAuthor = author.getAuthor().toLowerCase();

    // Already resolved — return immediately.
    if (this.sessionCacheAvatarUrls.has(lcAuthor)) {
      return this.sessionCacheAvatarUrls.get(lcAuthor);
    }

    // Already in-flight — share the existing Promise.
    if (this.pendingPromises.has(lcAuthor)) {
      return this.pendingPromises.get(lcAuthor);
    }

    if (this.pendingPromises.size > defaultSettings.MAX_REQUEST_SIZE) {
      console.warn(
        "Too many requests in progress, skipping avatar fetch for " +
          author.getAuthor(),
      );
      return null;
    }

    // The settings read happens inside the shared Promise: awaiting it before
    // registering the Promise would let concurrent callers for the same
    // author each start their own fetch.
    const promise = (async () => {
      return new ProfilePictureFetcher(
        window,
        author,
        "duckduckgo",
        false,
        {
          providers: await this.getProviderList(),
          privacyMode: await this.getPrivacyMode(),
          ...(await this.getCacheRefresh()),
        },
      ).getAvatar();
    })()
      .then((result) => {
        // Settings changed while this was in flight: callers already waiting
        // get the result, but it is not cached under the new settings.
        if (this.pendingPromises.get(lcAuthor) !== promise) {
          return result;
        }
        // FIFO eviction: drop oldest entry when cache is full.
        if (this.sessionCacheAvatarUrls.size >= MAX_CACHE_SIZE) {
          const firstKey = this.sessionCacheAvatarUrls.keys().next().value;
          this.sessionCacheAvatarUrls.delete(firstKey);
        }
        this.sessionCacheAvatarUrls.set(lcAuthor, result);
        return result;
      })
      .finally(() => {
        if (this.pendingPromises.get(lcAuthor) === promise) {
          this.pendingPromises.delete(lcAuthor);
        }
      });

    this.pendingPromises.set(lcAuthor, promise);
    return promise;
  }
}
