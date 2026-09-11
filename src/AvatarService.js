import SettingsManager from "../settings/SettingsManager.js";
import defaultSettings from "../settings/defaultSettings.js";
import Author from "./Author.js";
import CacheStorage from "./CacheStorage.js";
import ProfilePictureFetcher, { daysToMs } from "./ProfilePictureFetcher.js";

const Status = {
  WAITING: "[WAITING]",
};

/**
 * Service for managing avatar URLs.
 */
export default class AvatarService {
  constructor() {
    /**
     * Cache for storing avatar URLs for the session.
     * @type {Object.<string, string>}
     */
    this.sessionCacheAvatarUrls = {};
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
   */
  invalidateSettings() {
    this.providerList = null;
    this.privacyMode = null;
    this.cacheRefresh = null;
    this.sessionCacheAvatarUrls = {};
  }

  /**
   * Returns the number of avatars that are currently being fetched.
   * @returns {number} - The number of avatars being fetched.
   */
  countWaitingAvatars() {
    let waiting = 0;
    for (const key in this.sessionCacheAvatarUrls) {
      if (this.sessionCacheAvatarUrls[key] === Status.WAITING) {
        waiting++;
      }
    }
    return waiting;
  }

  /**
   * Retrieves the avatar URL for the given author.
   *
   * Steps:
   * 1. Check if the avatar URL is already in the session cache
   * 2. If not in cache:
   *    a. Check if we're already processing too many requests
   *    b. Store as waiting in the cache
   *    c. Fetch and store the avatar URL in the cache
   * 3. If the avatar is marked as waiting, poll until it's ready
   * 4. Return the cached avatar URL
   *
   * @param {Author} author - The author for whom to fetch the avatar URL.
   * @returns {Promise<string|null>} - The avatar URL or null if request limit exceeded or not found.
   */
  async getAvatar(author) {
    const lcAuthor = author.getAuthor().toLowerCase();
    if (!this.sessionCacheAvatarUrls[lcAuthor]) {
      if (this.countWaitingAvatars() > defaultSettings.MAX_REQUEST_SIZE) {
        console.warn(
          "Too many requests in progress, skipping avatar fetch for " +
            author.getAuthor(),
        );
        return null;
      }
      this.sessionCacheAvatarUrls[lcAuthor] = Status.WAITING;
      const profilePictureFetcher = new ProfilePictureFetcher(
        window,
        author,
        "duckduckgo",
        false,
        {
          providers: await this.getProviderList(),
          privacyMode: await this.getPrivacyMode(),
          ...(await this.getCacheRefresh()),
        },
      );
      this.sessionCacheAvatarUrls[lcAuthor] =
        await profilePictureFetcher.getAvatar();
    }
    while (this.sessionCacheAvatarUrls[lcAuthor] === Status.WAITING) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return this.sessionCacheAvatarUrls[lcAuthor];
  }
}
