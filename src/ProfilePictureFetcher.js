import defaultSettings from "../settings/defaultSettings.js";
import ProviderFactory from "../providers/ProviderFactory.js";
import {
  PrivacyMode,
  filterProvidersForPrivacy,
  getProviderDescriptor,
  reconcileProviderList,
} from "../providers/registry.js";
import Author from "./Author.js";
import CacheStorage from "./CacheStorage.js";
import { AvatarStrategy } from "./strategies/AvatarStrategy.js";
import { CacheStrategy } from "./strategies/CacheStrategy.js";
import { ContactsStrategy } from "./strategies/ContactsStrategy.js";
import { OnlineStrategy } from "./strategies/OnlineStrategy.js";
import { VoidStrategy } from "./strategies/VoidStrategy.js";

/**
 * Converts a day count from settings into milliseconds.
 * @param {number} days - Whole days; 0 means "never expire".
 * @returns {number} Milliseconds, or 0 for never.
 */
export function daysToMs(days) {
  return Number.isFinite(days) && days > 0 ? days * 24 * 3600 * 1000 : 0;
}

/**
 * Whether a cache entry has aged past its interval.
 *
 * An entry written before timestamps existed has no ts and counts as expired,
 * which is what re-resolves the pre-upgrade cache once. An interval of 0 means
 * the entry never expires, so an absent timestamp does not matter there.
 *
 * @param {number|undefined} ts - When the entry was written.
 * @param {number} intervalMs - Lifetime in milliseconds, or 0 for never.
 * @returns {boolean}
 */
export function isExpired(ts, intervalMs) {
  if (intervalMs <= 0) {
    return false;
  }
  return Date.now() - (ts || 0) > intervalMs;
}

export default class ProfilePictureFetcher {
  /**
   *
   * @param {Window} wdow Window object
   * @param {Author} authorObject Author object to fetch the avatar for
   * @param {string} providerName Provider name to use for fetching the avatar
   * @param {boolean} disableCache Disable cache
   */
  constructor(
    wdow,
    authorObject,
    providerName = "duckduckgo",
    disableCache = false,
    options = {},
  ) {
    const {
      providers = null,
      privacyMode = PrivacyMode.OFF,
      refreshFoundMs = daysToMs(defaultSettings.cacheRefreshFoundDays),
      refreshNotFoundMs = daysToMs(defaultSettings.cacheRefreshNotFoundDays),
    } = options;
    this.wdow = wdow;
    this.author = authorObject;
    this.providerName = providerName;
    this.domain = authorObject.getDomain();
    this.cache = new CacheStorage();
    this.disableCache = disableCache;
    // Resolved provider chain, in lookup order. Reconciled against the registry
    // so a stored list from an older release can't reference a provider that no
    // longer exists.
    // Privacy filtering is applied here, at the single point where the chain is
    // turned into lookups, so no caller can bypass it by constructing a fetcher
    // directly.
    this.privacyMode = privacyMode;
    this.providerList = filterProvidersForPrivacy(
      reconcileProviderList(providers ?? defaultSettings.providers),
      privacyMode,
    );
    this.refreshFoundMs = refreshFoundMs;
    this.refreshNotFoundMs = refreshNotFoundMs;
    // Providers are constructed lazily: building all eight up front meant
    // instantiating scrapers that the configured chain never consults.
    this.providerInstances = new Map();
  }

  /**
   * Returns the provider instance for an id, constructing it on first use.
   * @param {string} id - Provider id from the registry.
   * @returns {Provider|null} The provider, or null if it cannot be built.
   */
  getProvider(id) {
    if (!this.providerInstances.has(id)) {
      try {
        this.providerInstances.set(
          id,
          ProviderFactory.createProvider(id, this.wdow),
        );
      } catch (error) {
        console.error(`Unknown avatar provider \"${id}\"`, error);
        this.providerInstances.set(id, null);
      }
    }
    return this.providerInstances.get(id);
  }

  /**
   * Builds the online lookup steps for the enabled providers, in order.
   *
   * Domain providers get a second attempt against the subdomain-stripped
   * author, since mail from a subdomain usually wants the parent company's
   * logo. Email providers identify one person, so stripping the subdomain
   * would change who is being looked up and is skipped.
   *
   * @param {"email"|"domain"|null} kindFilter - Restrict to one provider kind.
   * @returns {Array<AvatarStrategy>} Ordered online strategies.
   */
  buildOnlineStrategies(kindFilter = null) {
    const strategies = [];
    for (const entry of this.providerList) {
      if (!entry.enabled) {
        continue;
      }
      const descriptor = getProviderDescriptor(entry.id);
      if (!descriptor || (kindFilter && descriptor.kind !== kindFilter)) {
        continue;
      }
      const provider = this.getProvider(entry.id);
      if (!provider) {
        continue;
      }
      strategies.push(new OnlineStrategy(this, provider, this.author));
      if (descriptor.kind === "domain" && this.author.hasSubDomain()) {
        strategies.push(
          new OnlineStrategy(this, provider, this.author.removeSubDomain()),
        );
      }
    }
    return strategies;
  }

  /**
   * Converts a blob to a URL
   * @param {Blob} blob blob to convert to URL
   * @returns {Promise<string>} URL of the blob (data URL)
   */
  async blobToUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Converts a blob to a file
   * @param {Blob} blob blob to convert to file
   * @returns {File} File object
   */
  blobToFile(blob) {
    const file = new File([blob], "avatar", { type: blob.type });
    return file;
  }

  /**
   * Saves a blob to the cache
   * @param {Blob} blob Blob to save
   * @param {string} iconDomain Domain associated with the icon
   * @param {string} source Source of the icon
   */
  async saveBlobToCache(blob, iconDomain, source) {
    if (this.disableCache) {
      return;
    }
    const iconPath = `ICON_${iconDomain}.ico`;

    await this.cache.saveIcon(iconPath, blob);

    const fileInfos = {
      path: iconPath,
      type: blob.type,
      ts: Date.now(),
      source: source,
    };

    this.cache.setProperty(`ICON_${iconDomain}`, fileInfos);
    if (source === "gravatar" || this.author.isPublic()) {
      this.cache.setProperty(`ICON_${this.author.getEmail()}`, fileInfos);
    } else {
      this.cache.setProperty(`ICON_${this.domain}`, fileInfos);
    }
  }

  /**
   * Saves a "not found" status to the cache
   * @param {string} iconDomain Domain associated with the icon
   */
  async saveNotFoundToCache(iconDomain) {
    if (this.disableCache) {
      return;
    }
    const notFoundObject = {
      type: "notFound",
      ts: Date.now(),
    };

    this.cache.setProperty(`ICON_${iconDomain}`, notFoundObject);
    if (this.author.isPublic()) {
      this.cache.setProperty(`ICON_${this.author.getEmail()}`, notFoundObject);
    } else {
      this.cache.setProperty(`ICON_${this.domain}`, notFoundObject);
    }
  }

  /**
   * Downloads an image from a URL
   * @param {string} url URL to download the image from
   * @param {string} iconDomain Domain associated with the icon
   * @param {string} source Source of the icon
   * @returns {Blob|null} Blob of the downloaded image or null if not found
   */
  async downloadImage(url, iconDomain, source = this.providerName) {
    return await this.wdow.fetch(url).then(async (response) => {
      if ((response.status === 404 && source === "gravatar") || !response.ok) {
        return null;
      }
      let blob = await response.blob();

      if (blob.type.includes("text/plain")) {
        const string = await blob.text();
        if (string.includes("svg")) {
          // wrong header returned by the server : text/plain instead of image/svg+xml
          // happens with noreply@recruiting.facebook.com for instance
          blob = new Blob([string], { type: "image/svg+xml" });
        } else {
          throw new Error("Invalid image type", blob.type);
        }
      }

      this.saveBlobToCache(blob, iconDomain, source);

      return blob;
    });
  }

  /**
   * Retrieves an icon from the cache
   * @param {string} domain Domain associated with the icon
   * @param {string|null} originalDomain Original domain associated with the icon
   * @returns {Blob|string|boolean} Blob of the icon, "notFound" if not found, or false if not in cache
   */
  async getFromCache(domain, originalDomain = null) {
    if (this.disableCache) {
      return false;
    }
    if (this.author.isPublic() && domain !== this.author.getEmail()) {
      originalDomain = this.author.getEmail();
    }
    const key = `ICON_${domain}`;

    const fileInfos = await this.cache.getProperty(key);
    if (!fileInfos) {
      return false;
    }

    try {
      if (fileInfos.type === "notFound") {
        // Enforce the not-found TTL so dead lookups eventually retry instead of
        // being cached forever. Treat an expired marker as a cache miss.
        if (isExpired(fileInfos.ts, this.refreshNotFoundMs)) {
          this.cache.removeProperty(key);
          return false;
        }
        return "notFound";
      }
      // Refresh stale icons so newly-added BIMI records or updated logos get
      // picked up. Treat an expired icon as a cache miss so the strategy chain
      // re-resolves it (BIMI is tried first).
      if (isExpired(fileInfos.ts, this.refreshFoundMs)) {
        this.cache.removeProperty(key);
        return false;
      }
      const blob = await this.cache.getIcon(fileInfos.path, fileInfos.type);
      if (originalDomain) {
        this.cache.setProperty(`ICON_${originalDomain}`, fileInfos);
      }
      return blob;
    } catch (_error) {
      // corrupted entry
      this.cache.removeProperty(key);
      return false;
    }
  }

  /**
   * Executes a series of strategies to fetch an avatar
   * @param {Array<AvatarStrategy>} strategies Array of strategies to execute
   * @returns {Blob|string} Blob of the avatar or "notFound" if not found
   */
  async executeStrategies(strategies) {
    for (const strategy of strategies) {
      const avatar = await strategy.fetchAvatar();
      if (avatar) return avatar;
    }
    return "notFound";
  }

  /**
   * Fetches the domain avatar using various strategies
   * @returns {Blob|string} Blob of the avatar or "notFound" if not found
   */
  async getDomainAvatar() {
    const topDomain = this.author.getTopDomain();
    // Every local lookup runs before any network one. The subdomain cache probe
    // used to sit between two online attempts, which meant a cache hit could be
    // reached only after a request had already gone out.
    const strategies = [
      new ContactsStrategy(this, this.author),
      new CacheStrategy(this, this.author.getEmail()),
      new CacheStrategy(this, this.domain),
      this.author.hasSubDomain()
        ? new CacheStrategy(this, topDomain)
        : new VoidStrategy(),
      ...this.buildOnlineStrategies(),
    ];
    return await this.executeStrategies(strategies);
  }

  /**
   * Fetches the public avatar using various strategies
   * @returns {Blob|string} Blob of the avatar or "notFound" if not found
   */
  async getPublicAvatar() {
    // Email providers only: a domain lookup against a public mail host returns
    // that host's own logo for every correspondent using it.
    const strategies = [
      new ContactsStrategy(this, this.author),
      new CacheStrategy(this, this.author.getEmail()),
      ...this.buildOnlineStrategies("email"),
    ];
    return await this.executeStrategies(strategies);
  }

  /**
   * Fetches the avatar blob
   * @returns {Blob|null} Blob of the avatar or null if not found
   */
  async getAvatarBlob() {
    try {
      const response = this.author.isPublic()
        ? await this.getPublicAvatar()
        : await this.getDomainAvatar();
      if (response === "notFound") {
        this.saveNotFoundToCache(this.domain);
        return null;
      }
      return response;
    } catch (error) {
      console.error("Error fetching avatar", error);
      return null;
    }
  }

  /**
   * Fetches the avatar in the specified format
   * @param {string} format Format of the avatar ("url" or "file")
   * @returns {Promise<string|File|null>} URL or File object of the avatar or null if not found
   */
  async getAvatar(format = "url") {
    const blob = await this.getAvatarBlob();
    if (blob) {
      return format === "file"
        ? this.blobToFile(blob)
        : await this.blobToUrl(blob);
    }
    return null;
  }
}
