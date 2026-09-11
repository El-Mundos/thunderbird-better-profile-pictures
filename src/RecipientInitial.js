import Author from "./Author.js";

// biome-ignore lint/complexity/noStaticOnlyClass: Groups all static methods together
export default class RecipientInitial {
  /** @type {Map<string, string>} */
  static _colorCache = new Map();

  /**
   * Generate a pastel oklch color string for a given identifier (e.g., email or name)
   * Supports light-dark CSS property for color scheme adaptation.
   * @param {string} identifier - Unique string for the recipient
   * @returns {string} - oklch color string or light-dark() CSS function
   */
  static getColor(identifier) {
    if (RecipientInitial._colorCache.has(identifier)) {
      return RecipientInitial._colorCache.get(identifier);
    }

    // Simple hash function
    let hash = 0;
    for (let i = 0; i < identifier.length; i++) {
      hash = (hash << 5) - hash + identifier.charCodeAt(i);
      hash |= 0; // Convert to 32bit integer
    }

    const hue = (Math.abs(hash) % 36000) / 100; // 0.00 - 359.99

    const lightnessLight = 0.8 + (Math.abs(hash) % 10) / 100; // 0.80 - 0.89
    const chromaLight = 0.05 + (Math.abs(hash) % 5) / 1000; // 0.050 - 0.054
    const lightnessDark = 0.4 + (Math.abs(hash) % 10) / 100; // 0.40 - 0.49
    const chromaDark = 0.05 + (Math.abs(hash) % 5) / 1000; // 0.050 - 0.054

    const light = `oklch(${lightnessLight.toFixed(2)} ${chromaLight.toFixed(3)} ${hue.toFixed(2)})`;
    const dark = `oklch(${lightnessDark.toFixed(2)} ${chromaDark.toFixed(3)} ${hue.toFixed(2)})`;

    const color = `light-dark(${light}, ${dark})`;
    RecipientInitial._colorCache.set(identifier, color);
    return color;
  }

  /**
   * A single muted tone for every correspondent, for people who find the
   * per-sender colours noisy in a long message list.
   * @returns {string} light-dark() colour string.
   */
  static getNeutralColor() {
    return "light-dark(oklch(0.88 0 0), oklch(0.42 0 0))";
  }

  /**
   * Builds initials for the given author.
   * @param {Author} author - The author object.
   * @param {string} [colorMode="auto"] - "auto" derives a colour from the
   *   address so a given sender always looks the same; "neutral" uses one grey.
   * @returns {Object} - The initials object.
   */
  static buildInitials(author, colorMode = "auto") {
    const identifier = author.getEmail() || author.getAuthor() || "";
    return {
      value: `//INITIAL:${author.getInitials()}`,
      color:
        colorMode === "neutral"
          ? RecipientInitial.getNeutralColor()
          : RecipientInitial.getColor(identifier),
      identifier,
    };
  }
}
