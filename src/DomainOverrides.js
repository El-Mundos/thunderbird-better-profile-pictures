/**
 * Per-sender rules that take precedence over the normal lookup chain.
 *
 * Two things the chain cannot express on its own: a correspondent whose
 * automatically-found logo is wrong (a parked domain, a shared host, a
 * rebrand the sources have not caught up with), and a correspondent whose
 * picture should never be shown at all.
 *
 * @typedef {Object} DomainOverride
 * @property {string} match - An address or a domain, lower-cased.
 * @property {"hide"|"url"} mode - Show initials instead, or pin an image.
 * @property {string} [url] - Image to use when mode is "url".
 */

/**
 * Normalises a user-entered match value.
 *
 * Accepts what people actually type: stray whitespace, mixed case, a leading
 * "@" for a domain, or a full URL pasted instead of a domain.
 *
 * @param {string} value - Raw input.
 * @returns {string} Normalised match key, or "" if nothing usable remains.
 */
export function normalizeMatch(value) {
  if (typeof value !== "string") {
    return "";
  }
  let match = value.trim().toLowerCase();
  match = match.replace(/^[a-z]+:\/\//, "");
  match = match.replace(/^@/, "");
  match = match.replace(/\/.*$/, "");
  return match;
}

/**
 * Finds the rule that applies to an author, most specific first.
 *
 * A full address beats a domain, and a domain beats its parent, so a rule for
 * one address does not have to fight a rule for the whole company. Parent
 * matching means a rule on "example.com" also covers "mail.example.com",
 * which is what someone adding a company-wide rule expects.
 *
 * @param {Array<DomainOverride>} overrides - Configured rules.
 * @param {Object} author - Author to match.
 * @returns {DomainOverride|null} The winning rule, or null.
 */
export function findOverride(overrides, author) {
  if (!Array.isArray(overrides) || overrides.length === 0) {
    return null;
  }
  const email = (author.getEmail?.() || "").toLowerCase();
  const domain = (author.getDomain?.() || "").toLowerCase();

  const candidates = [email, domain];
  // Walk up the domain, stopping before the public suffix so a rule can never
  // be written against something as broad as "com".
  const labels = domain.split(".");
  for (let i = 1; i < labels.length - 1; i++) {
    candidates.push(labels.slice(i).join("."));
  }

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const hit = overrides.find(
      (override) => normalizeMatch(override.match) === candidate,
    );
    if (hit) {
      return hit;
    }
  }
  return null;
}

/**
 * Drops entries a user has half-finished or that would never match, so the
 * lookup path never has to defend against them.
 *
 * @param {Array<DomainOverride>} overrides - Raw stored rules.
 * @returns {Array<DomainOverride>} Usable rules.
 */
export function sanitizeOverrides(overrides) {
  if (!Array.isArray(overrides)) {
    return [];
  }
  const seen = new Set();
  const clean = [];
  for (const override of overrides) {
    const match = normalizeMatch(override?.match);
    if (!match || seen.has(match)) {
      continue;
    }
    if (override.mode === "url") {
      const url = typeof override.url === "string" ? override.url.trim() : "";
      // Only http(s) and data URLs: the value is fetched, so anything else is
      // either useless or a way to point the add-on at the local filesystem.
      if (!/^(https?:\/\/|data:image\/)/i.test(url)) {
        continue;
      }
      clean.push({ match, mode: "url", url });
      seen.add(match);
      continue;
    }
    clean.push({ match, mode: "hide" });
    seen.add(match);
  }
  return clean;
}
