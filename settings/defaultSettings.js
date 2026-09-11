/**
 * Default settings for the application.
 * @type {Object}
 * @property {boolean} inboxListEnabled - Whether the inbox list feature is enabled. MUTABLE.
 * @property {boolean} contactsIntegrationEnabled - Whether the contacts integration feature is enabled. MUTABLE.
 * @property {Array<string>} publicMails - List of public mail domains.
 * @property {number} notFoundRefreshIntervalMs - Interval in milliseconds to refresh not found avatars.
 * @property {number} foundRefreshIntervalMs - Interval after which a cached icon is re-fetched, so newly-added BIMI records / logo changes are picked up.
 * @property {number} WAIT_TIME_MS - Wait time in milliseconds for displaying the inbox list.
 * @property {number} SUBBATCH_SIZE - Size of the subbatch for processing messages.
 * @property {Array<{id: string, enabled: boolean}>} providers - Avatar providers in lookup order. MUTABLE.
 */
const defaultSettings = {
  inboxListEnabled: true,
  contactsIntegrationEnabled: true,
  publicMails: [
    "gmail",
    "yahoo",
    "hotmail",
    "outlook",
    "aol",
    "protonmail",
    "yandex",
    "icloud",
    "gmx",
    "laposte",
    "sfr",
    "free",
    "bbox",
    "wanadoo",
    "orange.fr",
    "live",
    "msn",
    "yandex",
  ],
  notFoundRefreshIntervalMs: 1000 * 3600 * 24 * 1,
  foundRefreshIntervalMs: 1000 * 3600 * 24 * 14,
  WAIT_TIME_MS: 200,
  SUBBATCH_SIZE: 15,
  MAX_REQUEST_SIZE: 100,
  // Avatar providers, in the order they are tried. Only enabled entries are
  // consulted, and the first hit wins, so order is a real behaviour knob:
  // earlier entries cost latency on every miss but win on every hit.
  //
  // The default keeps BIMI first (authoritative — the sender's own domain
  // publishes it, and it involves no third party), then Gravatar for
  // individuals, then DuckDuckGo for company logos. The rest ship disabled:
  // they are alternative sources for the same lookups, so enabling all of them
  // mostly adds round-trips to the miss path rather than finding more logos.
  providers: [
    { id: "bimi", enabled: true },
    { id: "gravatar", enabled: true },
    { id: "duckduckgo", enabled: true },
    { id: "google", enabled: false },
    { id: "libravatar", enabled: false },
    { id: "iconhorse", enabled: false },
    { id: "splitbee", enabled: false },
    { id: "favicon_webpage", enabled: false },
  ],
};

export default defaultSettings;
