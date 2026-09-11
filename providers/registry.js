/**
 * Single source of truth describing every avatar provider.
 *
 * ProviderFactory, the default settings, the lookup chains and the options UI
 * all read from this list, so adding a provider means adding one entry here
 * rather than touching four files.
 *
 * @typedef {Object} ProviderDescriptor
 * @property {string} id - Provider id, matching ProviderFactory.createProvider.
 * @property {string} labelKey - _locales message key for the display name.
 * @property {"email"|"domain"} kind - What the provider looks the avatar up by.
 *   "email" providers hash or query a specific address and are the only ones
 *   meaningful for public mail hosts: a domain lookup on gmail.com returns
 *   Gmail's own logo for every sender, which is why the public chain has always
 *   been restricted to them.
 * @property {"dns"|"sender-site"|"third-party"} disclosure - Who learns that you
 *   received this mail, when the provider resolves.
 *     "dns"         - a DNS lookup against the sender's domain, plus fetching
 *                     the logo the record points at. No outside party, and no
 *                     request to the sender's web server.
 *     "sender-site" - fetches and parses a page from the sender's own web
 *                     server. No outside party, but a direct, timed hit on
 *                     their site that correlates with you opening the message.
 *     "third-party" - sends the correspondent's address or domain to a service
 *                     unrelated to the sender.
 * @property {boolean} slow - Whether a miss is expensive. Currently only the
 *   favicon scraper, which fetches and parses a full page.
 */

/** @type {Array<ProviderDescriptor>} */
export const PROVIDERS = [
  {
    id: "bimi",
    labelKey: "providerBimi",
    kind: "domain",
    disclosure: "dns",
    slow: false,
  },
  {
    id: "gravatar",
    labelKey: "providerGravatar",
    kind: "email",
    disclosure: "third-party",
    slow: false,
  },
  {
    id: "libravatar",
    labelKey: "providerLibravatar",
    kind: "email",
    disclosure: "third-party",
    slow: false,
  },
  {
    id: "duckduckgo",
    labelKey: "providerDuckDuckGo",
    kind: "domain",
    disclosure: "third-party",
    slow: false,
  },
  {
    id: "google",
    labelKey: "providerGoogle",
    kind: "domain",
    disclosure: "third-party",
    slow: false,
  },
  {
    id: "iconhorse",
    labelKey: "providerIconHorse",
    kind: "domain",
    disclosure: "third-party",
    slow: false,
  },
  {
    id: "splitbee",
    labelKey: "providerSplitbee",
    kind: "domain",
    disclosure: "third-party",
    slow: false,
  },
  {
    id: "favicon_webpage",
    labelKey: "providerFaviconWebpage",
    kind: "domain",
    disclosure: "sender-site",
    slow: true,
  },
];

/**
 * Whether a provider discloses the correspondent to an unrelated service.
 * @param {ProviderDescriptor} descriptor
 * @returns {boolean}
 */
export function isThirdParty(descriptor) {
  return descriptor.disclosure === "third-party";
}

/**
 * Looks up a provider descriptor by id.
 * @param {string} id
 * @returns {ProviderDescriptor|undefined}
 */
export function getProviderDescriptor(id) {
  return PROVIDERS.find((provider) => provider.id === id);
}

/**
 * Privacy modes, in increasing order of strictness.
 *
 * OFF      - every enabled provider runs; current behaviour.
 * BALANCED - DNS-backed lookups only, which today means BIMI. No outside
 *            service learns who you correspond with, and the sender's web
 *            server sees no request tied to you opening the message.
 * STRICT   - no network lookups of any kind. Address book photos, the on-disk
 *            cache and generated initials only.
 * @enum {string}
 */
export const PrivacyMode = {
  OFF: "off",
  BALANCED: "balanced",
  STRICT: "strict",
};

/**
 * Filters the provider chain according to the active privacy mode.
 *
 * Called before the chain is turned into lookup strategies, so anything
 * removed here never issues a request. Local steps — address book, cache,
 * initials — sit outside the provider chain and are unaffected by every mode.
 *
 * @param {Array<{id: string, enabled: boolean}>} providerList - Chain in order.
 * @param {string} mode - A PrivacyMode value.
 * @returns {Array<{id: string, enabled: boolean}>} Chain with disallowed
 *   providers disabled (keep them in the list with enabled:false rather than
 *   dropping them, so the options page can still show them greyed out and the
 *   user's own on/off choices survive turning the mode back off).
 */
export function filterProvidersForPrivacy(providerList, mode) {
  if (mode === PrivacyMode.OFF) {
    return providerList;
  }
  // BALANCED permits only DNS-backed lookups. The favicon scraper is excluded
  // even though it contacts no outside party: fetching a page from the sender's
  // web server is a timed request that correlates with you opening the message,
  // which is a louder signal than resolving a DNS record.
  const allowed = mode === PrivacyMode.BALANCED ? new Set(["dns"]) : new Set();
  return providerList.map((entry) => {
    const descriptor = getProviderDescriptor(entry.id);
    if (!descriptor || allowed.has(descriptor.disclosure)) {
      return entry;
    }
    // Disabled rather than dropped, so the options page can still show the
    // source greyed out and the user's own choices survive turning the mode off.
    return { ...entry, enabled: false };
  });
}

/**
 * Whether a provider is permitted under a privacy mode, ignoring whether the
 * user has it switched on. Used by the options UI to grey out blocked rows.
 * @param {ProviderDescriptor} descriptor
 * @param {string} mode - A PrivacyMode value.
 * @returns {boolean}
 */
export function isAllowedInMode(descriptor, mode) {
  if (mode === PrivacyMode.OFF) {
    return true;
  }
  return mode === PrivacyMode.BALANCED && descriptor.disclosure === "dns";
}

/**
 * Reconciles a stored provider list against the registry.
 *
 * Stored settings are written once and read for years, so they drift: a
 * provider added in a later release is missing from them, and a provider
 * removed from the registry lingers. Drop unknown ids and append any registry
 * entries the stored list has never seen (disabled, so a new provider never
 * silently starts making requests on upgrade).
 *
 * @param {Array<{id: string, enabled: boolean}>} stored - Possibly stale list.
 * @returns {Array<{id: string, enabled: boolean}>} Reconciled list.
 */
export function reconcileProviderList(stored) {
  const known = Array.isArray(stored)
    ? stored.filter((entry) => entry && getProviderDescriptor(entry.id))
    : [];
  const seen = new Set(known.map((entry) => entry.id));
  const added = PROVIDERS.filter((provider) => !seen.has(provider.id)).map(
    (provider) => ({ id: provider.id, enabled: false }),
  );
  return [...known, ...added];
}
