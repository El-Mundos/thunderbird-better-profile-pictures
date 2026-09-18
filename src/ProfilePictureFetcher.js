import { Scope } from "../providers/Provider.js";
import ProviderFactory from "../providers/ProviderFactory.js";
import {
  filterProvidersForPrivacy,
  getProviderDescriptor,
  PrivacyMode,
  reconcileProviderList,
} from "../providers/registry.js";
import defaultSettings from "../settings/defaultSettings.js";
import Author from "./Author.js";
import CacheStorage from "./CacheStorage.js";
import { findOverride, sanitizeOverrides } from "./DomainOverrides.js";
import ImageConverter from "./ImageConverter.js";
import { AvatarStrategy } from "./strategies/AvatarStrategy.js";
import { CacheStrategy } from "./strategies/CacheStrategy.js";
import { ContactsStrategy } from "./strategies/ContactsStrategy.js";
import { OnlineStrategy } from "./strategies/OnlineStrategy.js";

/**
 * Side of the PNG an SVG avatar is rendered to. The largest avatar drawn is
 * 48 CSS pixels (conversation popups); this keeps it sharp at 3x scaling.
 */
const SVG_RASTER_SIZE = 144;

/**
 * Largest picture that will be downloaded. Real favicons, logos and avatars
 * stay well under 300 KiB, multi-resolution .ico files being the largest.
 */
const MAX_IMAGE_BYTES = 1024 * 1024;

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
      overrides = defaultSettings.domainOverrides,
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
    this.overrides = sanitizeOverrides(overrides);
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
        console.error(`Unknown avatar provider "${id}"`, error);
        this.providerInstances.set(id, null);
      }
    }
    return this.providerInstances.get(id);
  }

  /**
   * Builds one lookup step per enabled provider, in chain order.
   *
   * Domain providers get a second attempt against the subdomain-stripped
   * author, since mail from a subdomain usually wants the parent company's
   * logo. Email providers identify one person, so stripping the subdomain
   * would change who is being looked up and is skipped.
   *
   * @param {"email"|"domain"|null} kindFilter - Restrict to one provider kind.
   * @returns {Array<{kind: string, name: string, strategies: Array<AvatarStrategy>}>}
   *   Steps in lookup order; `name` is what the cache records as the source.
   */
  buildProviderSteps(kindFilter = null) {
    const steps = [];
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
      const strategies = [new OnlineStrategy(this, provider, this.author)];
      if (descriptor.kind === "domain" && this.author.hasSubDomain()) {
        strategies.push(
          new OnlineStrategy(this, provider, this.author.removeSubDomain()),
        );
      }
      steps.push({ kind: descriptor.kind, name: provider.name, strategies });
    }
    return steps;
  }

  /**
   * The online lookups of the enabled providers, in order.
   * @param {"email"|"domain"|null} kindFilter - Restrict to one provider kind.
   * @returns {Array<AvatarStrategy>} Ordered online strategies.
   */
  buildOnlineStrategies(kindFilter = null) {
    return this.buildProviderSteps(kindFilter).flatMap(
      ({ strategies }) => strategies,
    );
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
   * Reads a response body, giving up once it passes MAX_IMAGE_BYTES.
   *
   * The URL often comes from the sender (a BIMI record, a pinned rule, a
   * scraped <link>), so the size is theirs to choose. Reading in chunks stops
   * an oversized body before it is held in memory in full.
   *
   * @param {Response} response Successful response
   * @returns {Promise<Blob>} Body, typed from its Content-Type header
   * @throws {Error} If the body is missing or too large
   */
  async readCappedBody(response) {
    if (!response.body) {
      throw new Error("Empty response body");
    }
    const declared = Number(response.headers.get("content-length"));
    if (declared > MAX_IMAGE_BYTES) {
      response.body.cancel();
      throw new Error(`Image too large (${declared} bytes)`);
    }
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        reader.cancel();
        throw new Error(`Image too large (over ${MAX_IMAGE_BYTES} bytes)`);
      }
      chunks.push(value);
    }
    return new Blob(chunks, {
      type: response.headers.get("content-type") || "",
    });
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
      let blob = await this.readCappedBody(response);

      if (blob.type.includes("text/plain")) {
        const string = await blob.text();
        if (string.includes("svg")) {
          // wrong header returned by the server : text/plain instead of image/svg+xml
          // happens with noreply@recruiting.facebook.com for instance
          blob = new Blob([string], { type: "image/svg+xml" });
        } else {
          throw new Error(`Invalid image type ${blob.type}`);
        }
      }

      // Hosts answer a miss with a 200 page, and the favicon scraper follows
      // <link> hrefs that lead to HTML. Neither is a picture, and caching one
      // keeps it for the whole refresh interval.
      if (!blob.type.startsWith("image/")) {
        throw new Error(`Invalid image type ${blob.type || "(none)"}`);
      }

      this.saveBlobToCache(blob, iconDomain, source);

      return blob;
    });
  }

  /**
   * Reads a cache entry, honouring the cache lifetimes.
   * @param {string} domain Domain or address the entry is stored under
   * @returns {Promise<{blob: Blob, fileInfos: Object}|"notFound"|null>} The
   *   picture with its metadata, "notFound" for a recorded miss, or null.
   */
  async getCacheEntry(domain) {
    if (this.disableCache) {
      return null;
    }
    const key = `ICON_${domain}`;

    const fileInfos = await this.cache.getProperty(key);
    if (!fileInfos) {
      return null;
    }

    try {
      if (fileInfos.type === "notFound") {
        // Enforce the not-found TTL so dead lookups eventually retry instead of
        // being cached forever. Treat an expired marker as a cache miss.
        if (isExpired(fileInfos.ts, this.refreshNotFoundMs)) {
          this.cache.removeProperty(key);
          return null;
        }
        return "notFound";
      }
      // Refresh stale icons so newly-added BIMI records or updated logos get
      // picked up. Treat an expired icon as a cache miss so the strategy chain
      // re-resolves it (BIMI is tried first).
      if (isExpired(fileInfos.ts, this.refreshFoundMs)) {
        this.cache.removeProperty(key);
        return null;
      }
      const blob = await this.cache.getIcon(fileInfos.path, fileInfos.type);
      return { blob, fileInfos };
    } catch (_error) {
      // corrupted entry
      this.cache.removeProperty(key);
      return null;
    }
  }

  /**
   * Retrieves an icon from the cache
   * @param {string} domain Domain associated with the icon
   * @param {string|null} originalDomain Original domain associated with the icon
   * @returns {Blob|string|boolean} Blob of the icon, "notFound" if not found, or false if not in cache
   */
  async getFromCache(domain, originalDomain = null) {
    if (this.author.isPublic() && domain !== this.author.getEmail()) {
      originalDomain = this.author.getEmail();
    }
    const entry = await this.getCacheEntry(domain);
    if (!entry) {
      return false;
    }
    if (entry === "notFound") {
      return "notFound";
    }
    if (originalDomain) {
      this.cache.setProperty(`ICON_${originalDomain}`, entry.fileInfos);
    }
    return entry.blob;
  }

  /**
   * Records a miss under one key only.
   * @param {string} key Domain or address the miss is stored under
   */
  saveNotFound(key) {
    if (this.disableCache) {
      return;
    }
    this.cache.setProperty(`ICON_${key}`, { type: "notFound", ts: Date.now() });
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
   * Fetches the domain avatar, walking the provider chain in its order.
   *
   * The cache holds two levels. The address's entry is this person's own
   * result. The domain's entry is what the domain providers (BIMI, favicons)
   * found for everyone there, and it answers only for those providers:
   *  - a domain with no logo no longer stops the next person there from being
   *    looked up on Gravatar;
   *  - a logo found for one person does not win over another's Gravatar
   *    when Gravatar comes first in the chain. The logo stands at the
   *    position of the provider that found it; domain providers before that
   *    one had already missed and are skipped.
   *
   * Each kind's miss is recorded once all its providers were asked and
   * missed, whatever the final result, so the next lookup can skip them.
   *
   * @returns {Blob|string} Blob of the avatar or "notFound" if not found
   */
  async getDomainAvatar() {
    const contact = await new ContactsStrategy(this, this.author).fetchAvatar();
    if (contact) {
      return contact;
    }
    // Every local lookup runs before any network one.
    const own = await this.getCacheEntry(this.author.getEmail());
    if (own && own !== "notFound") {
      // This person's own earlier result: everything before it had missed.
      return own.blob;
    }
    const cached = {
      email: own,
      domain:
        (await this.getCacheEntry(this.domain)) ??
        (this.author.hasSubDomain()
          ? await this.getCacheEntry(this.author.getTopDomain())
          : null),
    };
    const steps = this.buildProviderSteps();
    const missed = { email: 0, domain: 0 };
    const recordMisses = () => {
      const keys = { email: this.author.getEmail(), domain: this.domain };
      for (const kind of ["email", "domain"]) {
        const total = steps.filter((step) => step.kind === kind).length;
        if (cached[kind] === null && total > 0 && missed[kind] === total) {
          this.saveNotFound(keys[kind]);
        }
      }
    };

    for (const { kind, name, strategies } of steps) {
      const entry = cached[kind];
      if (entry === "notFound") {
        continue;
      }
      if (entry) {
        const source = entry.fileInfos.source;
        // A source no longer in the chain (disabled since, or recorded by an
        // older release) is taken at the first provider of its kind.
        const inChain = steps.some((step) => step.name === source);
        if (source === name || !inChain) {
          recordMisses();
          return entry.blob;
        }
        continue;
      }
      for (const strategy of strategies) {
        const avatar = await strategy.fetchAvatar();
        if (avatar) {
          recordMisses();
          return avatar;
        }
      }
      missed[kind]++;
    }
    // The subdomain-stripped parent's miss is not recorded on disk: it would
    // stop lookups for sibling subdomains, which may have a logo of their
    // own. DomainLookups remembers it for the session instead.
    recordMisses();
    return "notFound";
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
      const override = findOverride(this.overrides, this.author);
      if (override) {
        if (override.mode === "hide") {
          // A user rule, not a failed lookup, so no notFound marker is written.
          // Caching one would keep the sender blank after the rule is removed,
          // until the marker expired.
          return null;
        }
        const pinned = await this.fetchOverrideImage(override);
        if (pinned) {
          return pinned;
        }
        // A pinned image that fails to load falls through to the normal chain
        // rather than leaving the sender blank: a dead URL in a rule written
        // months ago should degrade, not break.
        console.warn(`Pinned image failed for ${override.match}`);
      }

      if (!this.author.isPublic()) {
        const response = await this.getDomainAvatar();
        return response === "notFound" ? null : response;
      }
      const response = await this.getPublicAvatar();
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
   * Fetches a pinned image through the normal download path.
   *
   * Wraps the URL in a minimal provider so OnlineStrategy's fetching, content
   * type handling and conversion are reused rather than duplicated. Caching is
   * suppressed for the duration: a pinned image stored under the domain key
   * would outlive the rule that produced it and keep being served after the
   * rule was removed or changed.
   *
   * @param {Object} override - The matching rule.
   * @returns {Promise<Blob|null>} The image, or null if it could not be loaded.
   */
  async fetchOverrideImage(override) {
    const wasDisabled = this.disableCache;
    this.disableCache = true;
    try {
      const provider = {
        name: "override",
        scope: Scope.DOMAIN,
        getUrl: async () => override.url,
      };
      return await new OnlineStrategy(
        this,
        provider,
        this.author,
        false,
      ).fetchAvatar();
    } finally {
      this.disableCache = wasDisabled;
    }
  }

  /**
   * Rasterizes an SVG avatar so that only pixels ever leave the background.
   *
   * SVG is markup, and most of it comes from whoever controls the sender's
   * domain: BIMI logos are fetched from a URL their DNS record chooses. A
   * data URL is painted into Thunderbird's own chrome documents by headerApi,
   * where an SVG's <style> would apply to the whole page. A PNG carries no
   * markup, so it can be painted there without trusting its author.
   *
   * @param {Blob} blob Avatar image
   * @returns {Promise<Blob|null>} The blob unchanged if it is not SVG, a PNG
   *   rendering if it is, or null if the SVG cannot be rendered.
   */
  async rasterizeSvg(blob) {
    if (!blob.type.startsWith("image/svg+xml")) {
      return blob;
    }
    try {
      return await new ImageConverter(blob).svgUrlToFile(
        await blob.text(),
        SVG_RASTER_SIZE,
      );
    } catch (error) {
      console.warn("Could not render SVG avatar", error);
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
    if (!blob) {
      return null;
    }
    if (format === "file") {
      return this.blobToFile(blob);
    }
    const displayable = await this.rasterizeSvg(blob);
    return displayable ? await this.blobToUrl(displayable) : null;
  }
}
