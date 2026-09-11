import { getProviderDescriptor } from "../../providers/registry.js";
import Author from "../../src/Author.js";
import CacheStorage from "../../src/CacheStorage.js";
import ProfilePictureFetcher from "../../src/ProfilePictureFetcher.js";
import SettingsManager from "../SettingsManager.js";

const cacheSizeElement = document.getElementById("cacheSize");
const clearCacheButton = document.getElementById("clearCache");
const inboxListCheckbox = document.getElementById("inboxList");
const contactsIntegrationCheckbox = document.getElementById(
  "contactsIntegration",
);
const providerListElement = document.getElementById("providerList");
const emailInput = document.getElementById("email");
const fetchButton = document.getElementById("fetchButton");
const profilePictureDiv = document.getElementById("profilePicture");
const cache = new CacheStorage();
const settingsManager = new SettingsManager(cache);

const PREVIEW_SIZE = 100;
const PREVIEW_BORDER_RADIUS = "8px";
const SVG_DATA_PREFIX = "data:image/svg+xml";
const DATA_URL_BASE64_REGEX = /^data:([^;]+);base64,(.+)$/;

function clearProfilePicture() {
  profilePictureDiv.textContent = "";
  while (profilePictureDiv.firstChild) {
    profilePictureDiv.removeChild(profilePictureDiv.firstChild);
  }
}

function createPreviewCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = PREVIEW_SIZE;
  canvas.height = PREVIEW_SIZE;
  canvas.style.borderRadius = PREVIEW_BORDER_RADIUS;
  return canvas;
}

function isSvgDataUrl(dataUrl) {
  return typeof dataUrl === "string" && dataUrl.startsWith(SVG_DATA_PREFIX);
}

function decodeSvgString(dataUrl) {
  if (!isSvgDataUrl(dataUrl)) {
    return null;
  }
  const base64Match = dataUrl.match(/^data:image\/svg\+xml;base64,(.+)$/);
  if (base64Match) {
    const atobFn = window.atob || atob;
    return atobFn(base64Match[1]);
  }
  const urlMatch = dataUrl.match(/^data:image\/svg\+xml,(.+)$/);
  if (urlMatch) {
    try {
      return decodeURIComponent(urlMatch[1]);
    } catch (error) {
      console.error("Error decoding SVG:", error);
    }
  }
  return null;
}

function buildSvgElement(dataUrl) {
  const svgString = decodeSvgString(dataUrl);
  if (!svgString) {
    return null;
  }
  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(svgString, "image/svg+xml");
  const parserError = svgDoc.querySelector("parsererror");
  if (parserError) {
    console.error("SVG parsing error:", parserError.textContent);
    return null;
  }
  const svgElement = svgDoc.documentElement;
  svgElement.setAttribute("width", PREVIEW_SIZE.toString());
  svgElement.setAttribute("height", PREVIEW_SIZE.toString());
  if (!svgElement.getAttribute("viewBox")) {
    const widthAttr = svgElement.getAttribute("width") || PREVIEW_SIZE;
    const heightAttr = svgElement.getAttribute("height") || PREVIEW_SIZE;
    svgElement.setAttribute("viewBox", `0 0 ${widthAttr} ${heightAttr}`);
  }
  svgElement.style.width = `${PREVIEW_SIZE}px`;
  svgElement.style.height = `${PREVIEW_SIZE}px`;
  svgElement.style.borderRadius = PREVIEW_BORDER_RADIUS;
  svgElement.style.display = "block";
  return document.importNode(svgElement, true);
}

async function drawDataUrlToPreviewCanvas(canvas, dataUrl) {
  const matches = dataUrl.match(DATA_URL_BASE64_REGEX);
  if (!matches) {
    throw new Error("Invalid data URL format");
  }
  const mimeType = matches[1];
  const base64Data = matches[2];
  const atobFn = window.atob || atob;
  const binaryString = atobFn(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType });
  const createImageBitmapFn = window.createImageBitmap || createImageBitmap;
  const imageBitmap = await createImageBitmapFn(blob);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
  ctx.drawImage(imageBitmap, 0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
}

async function renderCanvasPreview(url) {
  const canvas = createPreviewCanvas();
  profilePictureDiv.appendChild(canvas);
  if (isSvgDataUrl(url)) {
    const svgElement = buildSvgElement(url);
    if (!svgElement) {
      throw new Error("Invalid SVG data URL format");
    }
    canvas.replaceWith(svgElement);
    return;
  }
  await drawDataUrlToPreviewCanvas(canvas, url);
}

function renderImagePreview(url) {
  const img = document.createElement("img");
  img.src = url;
  img.width = PREVIEW_SIZE;
  img.height = PREVIEW_SIZE;
  profilePictureDiv.appendChild(img);
}

/**
 * Provider chain as shown in the UI. Held in memory so reordering doesn't need
 * a storage round-trip per click; persisted on every change.
 * @type {Array<{id: string, enabled: boolean}>}
 */
let providerState = [];

/**
 * Persists the current chain and tells the background to pick it up.
 */
async function persistProviders() {
  await settingsManager.setProviders(providerState);
  browser.runtime.sendMessage({ action: "refreshSettings" });
}

/**
 * Builds a small descriptive badge (third-party, slow).
 * @param {string} messageKey - _locales key for the badge text.
 * @param {string} className - Modifier class for styling.
 * @returns {HTMLElement}
 */
function buildProviderBadge(messageKey, className) {
  const badge = document.createElement("span");
  badge.className = `provider-badge ${className}`;
  badge.textContent = browser.i18n.getMessage(messageKey);
  return badge;
}

/**
 * Moves a provider within the chain and re-renders.
 * @param {number} index - Current position.
 * @param {number} delta - -1 to move up, +1 to move down.
 */
async function moveProvider(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= providerState.length) {
    return;
  }
  const [entry] = providerState.splice(index, 1);
  providerState.splice(target, 0, entry);
  renderProviders();
  await persistProviders();
}

/**
 * Builds one row: enable switch, name, badges, and reorder controls.
 * @param {{id: string, enabled: boolean}} entry
 * @param {number} index - Position in the chain.
 * @returns {HTMLElement|null} The row, or null for an unknown provider.
 */
function buildProviderRow(entry, index) {
  const descriptor = getProviderDescriptor(entry.id);
  if (!descriptor) {
    return null;
  }

  const row = document.createElement("li");
  row.className = "provider-row";

  const label = document.createElement("label");
  label.className = "provider-label";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.setAttribute("role", "switch");
  checkbox.checked = entry.enabled;
  checkbox.addEventListener("change", async () => {
    providerState[index].enabled = checkbox.checked;
    await persistProviders();
  });

  const name = document.createElement("span");
  name.textContent =
    browser.i18n.getMessage(descriptor.labelKey) || descriptor.id;

  label.append(checkbox, name);
  if (descriptor.thirdParty) {
    label.append(
      buildProviderBadge("providerBadgeThirdParty", "is-third-party"),
    );
  }
  if (descriptor.slow) {
    label.append(buildProviderBadge("providerBadgeSlow", "is-slow"));
  }

  const controls = document.createElement("div");
  controls.className = "provider-controls";
  for (const [delta, glyph, titleKey] of [
    [-1, "\u25B2", "providerMoveUp"],
    [1, "\u25BC", "providerMoveDown"],
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "provider-move";
    button.textContent = glyph;
    button.title = browser.i18n.getMessage(titleKey);
    button.setAttribute("aria-label", button.title);
    button.disabled =
      delta === -1 ? index === 0 : index === providerState.length - 1;
    button.addEventListener("click", () => moveProvider(index, delta));
    controls.append(button);
  }

  row.append(label, controls);
  return row;
}

/**
 * Re-renders the whole chain. The list is eight rows, so rebuilding it wholesale
 * is cheaper to reason about than patching rows in place.
 */
function renderProviders() {
  providerListElement.textContent = "";
  providerState.forEach((entry, index) => {
    const row = buildProviderRow(entry, index);
    if (row) {
      providerListElement.append(row);
    }
  });
}

async function initProviders() {
  providerState = await settingsManager.getProviders();
  renderProviders();
}

async function printCacheSize(domElement) {
  const detailedSize = await cache.formattedSize();
  const iconsCount = detailedSize.iconsCount;
  const size = detailedSize.size;
  let iconsText;
  if (iconsCount === 0) {
    iconsText = ` (${browser.i18n.getMessage("noIcons")})`;
  } else if (iconsCount === 1) {
    iconsText = ` (${browser.i18n.getMessage("oneIcon")})`;
  } else {
    iconsText = ` (${browser.i18n.getMessage("multipleIcons", iconsCount)})`;
  }
  domElement.textContent = size + iconsText;
}

async function clearCache() {
  await cache.clearCache();
  await printCacheSize(cacheSizeElement);
  clearCacheButton.disabled = true;
  clearCacheButton.textContent = browser.i18n.getMessage("cacheCleared");
}

function initOptions() {
  settingsManager.getInboxListEnabled().then((inboxListEnabled) => {
    inboxListCheckbox.checked = inboxListEnabled;
  });

  settingsManager
    .getContactsIntegrationEnabled()
    .then((contactsIntegrationEnabled) => {
      contactsIntegrationCheckbox.checked = contactsIntegrationEnabled;
    });
}

function setInboxList() {
  settingsManager.setInboxListEnabled(inboxListCheckbox.checked);
  browser.runtime.sendMessage({ action: "refreshSettings" });
}

function setContactsIntegration() {
  settingsManager.setContactsIntegrationEnabled(
    contactsIntegrationCheckbox.checked,
  );
  browser.runtime.sendMessage({ action: "refreshSettings" });
}

/**
 * Gets the Thunderbird version number
 * @returns {Promise<number>} - The major version number of Thunderbird
 */
async function getThunderbirdVersion() {
  try {
    const info = await browser.runtime.getBrowserInfo();
    const majorVersion = parseInt(info.version.split(".")[0], 10);
    return majorVersion;
  } catch (error) {
    console.error("Error getting Thunderbird version:", error);
    // Default to a high version number to use canvas approach if detection fails
    return 145;
  }
}

async function fetchProfilePicture() {
  fetchButton.disabled = true;
  profilePictureDiv.setAttribute("aria-busy", "true");
  profilePictureDiv.style.display = "flex";
  clearProfilePicture();

  const mail = await Author.fromAuthor(emailInput.value);
  const fetcher = new ProfilePictureFetcher(window, mail, "duckduckgo", true);
  const url = await fetcher.getAvatar();

  if (!url) {
    profilePictureDiv.textContent = browser.i18n.getMessage(
      "profilePictureNotFound",
    );
  } else {
    const tbVersion = await getThunderbirdVersion();
    const useCanvas = tbVersion === 145;
    try {
      if (useCanvas) {
        await renderCanvasPreview(url);
      } else {
        renderImagePreview(url);
      }
    } catch (error) {
      console.error("Error drawing image:", error);
      profilePictureDiv.textContent = browser.i18n.getMessage(
        "errorDisplayingImage",
      );
    }
  }
  fetchButton.disabled = false;
  profilePictureDiv.removeAttribute("aria-busy");
}

function setupLocalization() {
  for (const node of document.querySelectorAll("[data-l10n-id]")) {
    const l10nId = node.getAttribute("data-l10n-id");
    node.textContent = browser.i18n.getMessage(l10nId);
  }
  for (const node of document.querySelectorAll(
    "[data-l10n-attr-placeholder]",
  )) {
    const l10nId = node.getAttribute("data-l10n-attr-placeholder");
    node.setAttribute("placeholder", browser.i18n.getMessage(l10nId));
  }
  for (const node of document.querySelectorAll("[data-l10n-attr-title]")) {
    const l10nId = node.getAttribute("data-l10n-attr-title");
    node.setAttribute("title", browser.i18n.getMessage(l10nId));
  }
}

/**
 * Initialize the options page
 */
async function initialize() {
  await printCacheSize(cacheSizeElement);
  await initProviders();
  initOptions();
  clearCacheButton.addEventListener("click", clearCache);
  inboxListCheckbox.addEventListener("change", setInboxList);
  contactsIntegrationCheckbox.addEventListener(
    "change",
    setContactsIntegration,
  );
  fetchButton.addEventListener("click", fetchProfilePicture);
  setupLocalization();
}

initialize();
