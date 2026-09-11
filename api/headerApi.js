/**
 * Get the message window from a native tab (used for installation on message headers).
 *
 * @param {Object} nativeTab - The native tab object.
 * @returns {Object|null} - The message window or null if not found.
 */
function getMessageWindow(nativeTab) {
  if (nativeTab instanceof Ci.nsIDOMWindow) {
    return nativeTab.messageBrowser.contentWindow;
  } else if (nativeTab.mode && nativeTab.mode.name === "mail3PaneTab") {
    if (
      nativeTab.chromeBrowser.contentWindow.multiMessageBrowser &&
      !nativeTab.chromeBrowser.contentWindow.multiMessageBrowser.hidden
    ) {
      return nativeTab.chromeBrowser.contentWindow.multiMessageBrowser
        .contentWindow;
    }
    return nativeTab.chromeBrowser.contentWindow.messageBrowser.contentWindow;
  } else if (nativeTab.mode && nativeTab.mode.name === "mailMessageTab") {
    return nativeTab.chromeBrowser.contentWindow;
  } else if (nativeTab.browser?.contentWindow) {
    return nativeTab.browser.contentWindow;
  } else {
    return null;
  }
}

/**
 * Get the content window from a native tab (used for installation on inbox list).
 *
 * @param {Object} nativeTab - The native tab object.
 * @returns {Object|null} - The content window or null if not found.
 */
function getContentWindow(nativeTab) {
  if (nativeTab instanceof Ci.nsIDOMWindow) {
    return nativeTab.messageBrowser.contentWindow;
  } else if (
    nativeTab.mode &&
    (nativeTab.mode.name === "mail3PaneTab" ||
      nativeTab.mode.name === "mail3Pane")
  ) {
    return nativeTab.chromeBrowser.contentWindow;
  } else if (nativeTab.browser?.contentWindow) {
    return nativeTab.browser.contentWindow;
  } else {
    return nativeTab.browser.contentWindow;
  }
}

/**
 * Extracts email addresses from Thunderbird conversation popups.
 *
 * @param {Object} window - The window object.
 * @returns {Object} - An object containing styleLeftValues and popupValues.
 */
async function extractMailsThunderbirdConversation(window) {
  const { document } = window;
  const popupContainer = document.getElementById("popup-container");
  let popups = popupContainer.childNodes;

  let retryCount = 0;
  while (popups.length === 0 && retryCount < 20) {
    console.warn("Waiting for popups to load...");
    await new Promise((resolve) => window.setTimeout(resolve, 200));
    popups = popupContainer.childNodes;
    retryCount++;
  }

  if (popups.length === 0) {
    console.error("No popups found in the popup container.");
    return null;
  }

  /**
   * Extracts the email address from a popup.
   *
   * @param {HTMLElement} popup - The popup element.
   * @returns {string|null} - The email address or null if not found.
   */
  function extractMailFromPopup(popup) {
    const mail = popup.querySelector(".authorEmailAddress");
    if (mail) {
      return mail.textContent;
    }
    return null;
  }

  const styleLeftValues = {};
  const popupValues = [];

  for (const popup of popups) {
    const styleLeft = popup.style.left;
    if (styleLeftValues[styleLeft]) {
      styleLeftValues[styleLeft]++;
    } else {
      styleLeftValues[styleLeft] = 1;
    }

    const mail = extractMailFromPopup(popup);
    popupValues.push({
      left: styleLeft,
      mail: mail,
    });
  }

  return {
    styleLeftValues: styleLeftValues,
    popupValues: popupValues,
  };
}

/**
 * Gets the Thunderbird version number
 * @returns {number} - The major version number of Thunderbird
 */
function getThunderbirdVersion() {
  try {
    const appInfo = Services.appinfo;
    const version = appInfo.version;
    const majorVersion = parseInt(version.split(".")[0], 10);
    return majorVersion;
  } catch (error) {
    console.error("Error getting Thunderbird version:", error);
    // Default to a high version number to use canvas approach if detection fails
    return 145;
  }
}

const AVATAR_CLASS = "autoprofilepicture-item";
const AVATAR_DATA_QUERY = `[data-auto-profile-picture="true"], .${AVATAR_CLASS}, .autoprofilepictureimg`;
const SVG_DATA_PREFIX = "data:image/svg+xml";
const DEFAULT_FALLBACK_ICON =
  "chrome://messenger/skin/addressbook/icons/contact-generic.svg";
const INITIALS_PREFIX = "//INITIAL:";
const DATA_URL_REGEX = /^data:([^;,]+)(;base64)?,(.*)$/;
const ROW_AVATAR_REFERENCE = Symbol("autoProfilePictureRowAvatar");
const RECIPIENT_AVATAR_OWNER = "auto-profile-picture";
const EXTENSION_AVATAR_SELECTOR = `.recipient-avatar[data-auto-profile-picture-owner="${RECIPIENT_AVATAR_OWNER}"]`;

function hasInitialsValue(value) {
  return typeof value === "string" && value.includes(INITIALS_PREFIX);
}

function extractInitials(value) {
  return value.replace(INITIALS_PREFIX, "");
}

function markAvatarElement(element) {
  element.classList.add(AVATAR_CLASS);
  element.dataset.autoProfilePicture = "true";
  return element;
}

function createAvatarCanvas(doc, size, borderRadius = "50%") {
  const canvas = doc.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.borderRadius = borderRadius;
  return markAvatarElement(canvas);
}

function createAvatarImage(doc, url, attrs = {}) {
  const img = markAvatarElement(doc.createElement("img"));
  img.src = url;
  img.alt = attrs.alt || "Auto Profile Picture";
  for (const [attr, value] of Object.entries(attrs)) {
    if (attr === "alt") {
      continue;
    }
    if (value !== undefined && value !== null) {
      img.setAttribute(attr, value);
    }
  }
  return img;
}

function cacheRecipientAvatar(row, avatar) {
  if (!row || !avatar) {
    return;
  }
  row[ROW_AVATAR_REFERENCE] = avatar;
}

function getExtensionRecipientAvatar(row) {
  if (!row) {
    return null;
  }
  const cached = row[ROW_AVATAR_REFERENCE];
  if (cached?.isConnected) {
    return cached;
  }
  const existing = row.querySelector(EXTENSION_AVATAR_SELECTOR);
  if (existing) {
    cacheRecipientAvatar(row, existing);
    return existing;
  }
  return null;
}

function ensureAvatarOwnership(element) {
  if (element) {
    element.dataset.autoProfilePictureOwner = RECIPIENT_AVATAR_OWNER;
  }
  return element;
}

function cleanupDuplicateRecipientAvatars(container, keepAvatar = null) {
  if (!container) {
    return;
  }
  const duplicates = container.querySelectorAll(EXTENSION_AVATAR_SELECTOR);
  for (const avatar of duplicates) {
    if (avatar !== keepAvatar) {
      avatar.remove();
    }
  }
}

function mountRecipientAvatar(row, avatar) {
  if (!row || !avatar) {
    return;
  }
  const threadCardColumn = row.querySelector(".thread-card-column");
  if (threadCardColumn) {
    threadCardColumn.style.display = "flex";
    threadCardColumn.style.flexDirection = "row";
    cleanupDuplicateRecipientAvatars(threadCardColumn, avatar);
    if (!threadCardColumn.contains(avatar)) {
      threadCardColumn.appendChild(avatar);
    }
    return;
  }
  const correspondentColumn = row.querySelector(".correspondentcol-column");
  if (correspondentColumn) {
    cleanupDuplicateRecipientAvatars(correspondentColumn, avatar);
    if (correspondentColumn.firstChild !== avatar) {
      correspondentColumn.insertBefore(avatar, correspondentColumn.firstChild);
    }
  }
}

function isSvgDataUrl(dataUrl) {
  return typeof dataUrl === "string" && dataUrl.startsWith(SVG_DATA_PREFIX);
}

function decodeSvgPayload(dataUrl, win) {
  const base64Match = dataUrl.match(/^data:image\/svg\+xml;base64,(.+)$/);
  if (base64Match) {
    const atobFn = win.atob || atob;
    return atobFn(base64Match[1]);
  }
  const urlMatch = dataUrl.match(/^data:image\/svg\+xml,(.+)$/);
  if (urlMatch) {
    try {
      return decodeURIComponent(urlMatch[1]);
    } catch (error) {
      console.error("Error decoding SVG payload:", error);
      return null;
    }
  }
  console.error("Invalid SVG data URL format");
  return null;
}

function buildSvgElement(dataUrl, width, height, win) {
  const svgString = decodeSvgPayload(dataUrl, win);
  if (!svgString) {
    return null;
  }

  const parser = new win.DOMParser();
  const svgDoc = parser.parseFromString(svgString, "image/svg+xml");
  const parserError = svgDoc.querySelector("parsererror");
  if (parserError) {
    console.error("SVG parsing error:", parserError.textContent);
    return null;
  }

  const svgElement = svgDoc.documentElement;
  svgElement.setAttribute("width", width.toString());
  svgElement.setAttribute("height", height.toString());
  if (!svgElement.getAttribute("viewBox")) {
    svgElement.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }
  svgElement.style.display = "block";
  return markAvatarElement(win.document.importNode(svgElement, true));
}

/**
 * Removes all existing avatar elements from a container.
 * @param {HTMLElement} container - The container element to remove avatars from.
 */
function removeAvatarElements(container) {
  const avatarElements = container.querySelectorAll(AVATAR_DATA_QUERY);
  if (avatarElements.length === 0) {
    while (container.firstChild) {
      container.firstChild.remove();
    }
    return;
  }
  for (const element of avatarElements) {
    element.remove();
  }
}

function normalizeAvatarPayload(payload, fallbackIdentifier = null) {
  if (payload && typeof payload === "object") {
    const value = payload.value ?? payload.url ?? "";
    return {
      value,
      color: payload.color ?? null,
      identifier: payload.identifier ?? fallbackIdentifier ?? null,
    };
  }
  return {
    value: typeof payload === "string" ? payload : "",
    color: null,
    identifier: fallbackIdentifier ?? null,
  };
}

function determinePayloadType(value) {
  if (!value) {
    return "empty";
  }
  return hasInitialsValue(value) ? "initials" : "image";
}

function rememberAvatarMetadata(
  element,
  { identifier, type, value, color = null },
) {
  if (!element) {
    return;
  }
  if (identifier) {
    element.dataset.autoProfilePictureIdentifier = identifier;
  } else {
    delete element.dataset.autoProfilePictureIdentifier;
  }
  element.dataset.autoProfilePictureType = type;
  element.dataset.autoProfilePictureValue = value || "";
  if (color) {
    element.dataset.autoProfilePictureColor = color;
  } else {
    delete element.dataset.autoProfilePictureColor;
  }
}

function shouldSkipAvatarUpdate(
  element,
  { identifier, type, value, color = null, isTemporary = false },
) {
  if (!element || !identifier) {
    return false;
  }
  const { dataset } = element;
  if (dataset.autoProfilePictureIdentifier !== identifier) {
    return false;
  }
  const currentType = dataset.autoProfilePictureType;
  const currentValue = dataset.autoProfilePictureValue;
  const currentColor = dataset.autoProfilePictureColor || "";

  if (type === "initials") {
    if (currentType === "image") {
      return isTemporary;
    }
    return (
      currentType === "initials" &&
      currentValue === value &&
      currentColor === (color || "")
    );
  }

  if (type === "image") {
    return currentType === "image" && currentValue === value;
  }

  if (type === "empty") {
    return currentType === "empty";
  }

  return false;
}

function drawStaticImageToCanvas(canvas, iconUrl, size) {
  const img = canvas.ownerDocument.createElement("img");
  const handleLoad = () => {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
  };
  img.addEventListener("load", handleLoad, { once: true });
  img.src = iconUrl;
}

/**
 * Helper function to draw a data URL directly to canvas without triggering CSP.
 * For SVG images, replaces the canvas with an SVG element.
 * @param {string} dataUrl - The data URL to draw
 * @param {HTMLCanvasElement} canvas - The canvas element to draw to
 * @param {number} width - Target width
 * @param {number} height - Target height
 * @param {Window} win - The window object for accessing global functions
 * @returns {Promise<boolean>} - Returns true if successful, false otherwise
 */
async function drawDataUrlToCanvas(dataUrl, canvas, width, height, win) {
  try {
    if (isSvgDataUrl(dataUrl)) {
      const svgElement = buildSvgElement(dataUrl, width, height, win);
      if (!svgElement || !canvas.parentNode) {
        return false;
      }
      canvas.parentNode.replaceChild(svgElement, canvas);
      return true;
    }

    const matches = dataUrl.match(DATA_URL_REGEX);
    if (!matches) {
      console.error("Invalid data URL format");
      return false;
    }

    const mimeType = matches[1];
    const isBase64 = matches[2] === ";base64";
    const payload = matches[3];
    const atobFn = win.atob || atob;
    const binaryString = isBase64
      ? atobFn(payload)
      : decodeURIComponent(payload);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const BlobConstructor = win.Blob || Blob;
    const blob = new BlobConstructor([bytes], { type: mimeType });
    const createImageBitmapFn = win.createImageBitmap || createImageBitmap;
    const imageBitmap = await createImageBitmapFn(blob);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(imageBitmap, 0, 0, width, height);
    return true;
  } catch (error) {
    console.error("Error drawing data URL to canvas:", error);
    return false;
  }
}

/**
 * Installs avatars for Thunderbird conversation.
 *
 * @param {Object} window - The window object.
 * @param {Object} payload - The payload object containing URLs and data.
 */
async function installConversation(window, payload) {
  const tbVersion = getThunderbirdVersion();
  const useCanvas = tbVersion === 145;

  async function insertPictureInPopup(popup, url) {
    const avatar = popup.querySelector(".authorPicture");
    if (!avatar) return;

    removeAvatarElements(avatar);

    if (!url || url === "") {
      if (useCanvas) {
        const canvas = createAvatarCanvas(document, 48, "8px");
        avatar.appendChild(canvas);
        drawStaticImageToCanvas(canvas, DEFAULT_FALLBACK_ICON, 48);
      } else {
        avatar.appendChild(
          createAvatarImage(document, DEFAULT_FALLBACK_ICON, {
            alt: "Default contact picture",
          }),
        );
      }
      return;
    }

    if (useCanvas) {
      const canvas = createAvatarCanvas(document, 48, "8px");
      avatar.appendChild(canvas);
      await drawDataUrlToCanvas(url, canvas, 48, 48, window);
    } else {
      avatar.appendChild(createAvatarImage(document, url));
    }
  }

  async function replaceAuthorPictureInMessage(message, url) {
    if (!url || url === "") {
      const wrongInitials = message.querySelector("abbr.auto-profile-picture");
      if (wrongInitials) {
        wrongInitials.classList.remove("auto-profile-picture");
        wrongInitials.classList.add("contactInitials");
        removeAvatarElements(wrongInitials);
        if (!useCanvas) {
          wrongInitials.style.backgroundImage = null;
        }
      }
      return;
    }

    if (useCanvas) {
      const targetElement =
        message.querySelector(".contactInitials") ||
        message.querySelector(".auto-profile-picture");
      if (targetElement) {
        targetElement.classList.remove("contactInitials");
        targetElement.classList.add("contactAvatar");
        targetElement.classList.add("auto-profile-picture");
        targetElement.textContent = "";

        targetElement.style.background = null;

        removeAvatarElements(targetElement);

        const canvas = createAvatarCanvas(document, 32);
        targetElement.appendChild(canvas);

        await drawDataUrlToCanvas(url, canvas, 32, 32, window);
      } else {
        console.error("No contactInitials or auto-profile-picture found");
      }
    } else {
      // TB < 145 and TB 146+: Use background-image approach
      const contactInitials = message.querySelector(".contactInitials");
      if (contactInitials) {
        contactInitials.classList.remove("contactInitials");
        contactInitials.classList.add("contactAvatar");
        contactInitials.classList.add("auto-profile-picture");
        // Clear background color (oklch) when removing initials
        contactInitials.style.background = null;
        contactInitials.style.backgroundImage = `url("${url}")`;
        contactInitials.textContent = "\u00A0";
      } else {
        const autoProfilePicture = message.querySelector(
          ".auto-profile-picture",
        );
        if (autoProfilePicture) {
          // Clear background color (oklch) when removing initials
          autoProfilePicture.style.background = null;
          autoProfilePicture.style.backgroundImage = `url("${url}")`;
          autoProfilePicture.textContent = "\u00A0";
        } else {
          console.error("No contactInitials or auto-profile-picture found");
        }
      }
    }
  }

  const { document } = window;

  const conversationMailCache = payload.urls;

  const styleLeftValues = payload.data.styleLeftValues;
  const popupValues = payload.data.popupValues;

  const popupContainer = document.getElementById("popup-container");
  const popups = popupContainer.querySelectorAll(".fade-popup");

  let popupNumber = 0;
  for (const popup of popups) {
    const mail = popupValues[popupNumber].mail;
    if (mail) {
      await insertPictureInPopup(popup, conversationMailCache[mail]);
    }
    popupNumber++;
  }

  const mostCommonLeftValue = Object.keys(styleLeftValues).reduce((a, b) => {
    if (styleLeftValues[a] === styleLeftValues[b]) {
      const aParsed = parseFloat(a.replace("px", ""));
      const bParsed = parseFloat(b.replace("px", ""));
      return aParsed < bParsed ? a : b;
    }
    return styleLeftValues[a] > styleLeftValues[b] ? a : b;
  });

  const popupsWithMostCommonLeftValue = popupValues.filter(
    (popup) => popup.left === mostCommonLeftValue,
  );

  const messageList = document.getElementById("messageList");
  const messages = messageList.querySelectorAll(".message");

  let messageNumber = 0;
  for (const message of messages) {
    const mail = popupsWithMostCommonLeftValue[messageNumber].mail;
    if (mail) {
      await replaceAuthorPictureInMessage(message, conversationMailCache[mail]);
    }
    messageNumber++;
  }
}

/**
 * Installs an avatar or initials on the message header.
 *
 * @param {Object} window - The window object.
 * @param {Object} urls - The URLs object containing avatar URLs.
 * @returns {Object} - An object containing the status and optional data or error.
 */
async function installOnMessageHeader(window, urls) {
  const { document } = window;
  const entries = Object.entries(urls || {});
  const [mailIdentifier, urlOrObj] = entries[0] || [null, null];
  const normalizedPayload = normalizeAvatarPayload(urlOrObj, mailIdentifier);
  const url = normalizedPayload.value;
  const initialsColor = normalizedPayload.color;
  const identifier = normalizedPayload.identifier || mailIdentifier || null;
  const payloadType = determinePayloadType(url);

  const tbVersion = getThunderbirdVersion();
  const useCanvas = tbVersion === 145;

  const recipientAvatars = document.querySelectorAll(".recipient-avatar");
  let result = { status: "failed", error: "No URL found" };

  for (const recipientAvatar of recipientAvatars) {
    const hasAvatarClass = recipientAvatar.classList.contains("has-avatar");
    const isExtensionAvatar = Boolean(
      recipientAvatar.dataset.autoProfilePictureIdentifier,
    );
    if (hasAvatarClass && !isExtensionAvatar) {
      result = { status: "success" };
      continue;
    }

    if (
      shouldSkipAvatarUpdate(recipientAvatar, {
        identifier,
        type: payloadType,
        value: url,
        color: initialsColor,
        isTemporary: payloadType === "initials",
      })
    ) {
      result = { status: "success" };
      continue;
    }

    if (payloadType === "empty") {
      result = { status: "failed", error: "No URL found" };
      continue;
    }

    if (payloadType === "initials") {
      removeAvatarElements(recipientAvatar);

      let contactInitials = recipientAvatar.querySelector(
        "span.contactInitials",
      );
      if (!contactInitials) {
        contactInitials = document.createElement("span");
      }
      contactInitials.classList.add("contactInitials");
      contactInitials.classList.add("auto-profile-picture");
      contactInitials.dataset.autoProfilePicture = "true";
      const initials = extractInitials(url);
      if (contactInitials.textContent !== initials) {
        contactInitials.textContent = initials;
      }
      recipientAvatar.classList.remove("has-avatar");
      if (initialsColor) {
        recipientAvatar.style.background = initialsColor;
      } else {
        recipientAvatar.style.background = null;
      }
      recipientAvatar.appendChild(contactInitials);

      rememberAvatarMetadata(recipientAvatar, {
        identifier,
        type: "initials",
        value: url,
        color: initialsColor,
      });
      result = { status: "success" };
      continue;
    }

    removeAvatarElements(recipientAvatar);

    if (useCanvas) {
      const size = 34;
      const canvas = createAvatarCanvas(document, size);
      recipientAvatar.appendChild(canvas);
      await drawDataUrlToCanvas(url, canvas, size, size, window);
    } else {
      const img = createAvatarImage(document, url, {
        xmlns: "http://www.w3.org/1999/xhtml",
        "data-l10n-id": "message-header-recipient-avatar",
      });
      recipientAvatar.appendChild(img);
      recipientAvatar.style.background = null;
    }

    recipientAvatar.classList.add("has-avatar");
    rememberAvatarMetadata(recipientAvatar, {
      identifier,
      type: "image",
      value: url,
    });
    result = { status: "success" };
  }

  if (recipientAvatars.length > 0) {
    return result;
  }

  const popupContainer = document.getElementById("popup-container");
  if (popupContainer) {
    const dataMails = await extractMailsThunderbirdConversation(window, urls);
    return {
      status: "needData",
      data: dataMails,
    };
  }

  return {
    status: "failed",
  };
}

/**
 * Installs CSS styles for avatars.
 *
 * @param {Object} window - The window object.
 */
function installCss(window) {
  const { document } = window;
  const avatarCss = `
  :root {
    --recipient-avatar-size: 34px;
  }
  .recipient-avatar {
    height: var(--recipient-avatar-size);
    width: var(--recipient-avatar-size);
    border-radius: 50%;
    text-align: center;
    overflow: hidden;
    align-items: center;
    justify-content: center;
    display:inline-flex;
    vertical-align: middle;
    margin-inline-end: 1px;
    color: light-dark(#71717a, #a1a1aa);
    margin-top: 1px;
  }
  .recipient-avatar.no-avatar {
    background-color: light-dark(#d4d4d8, #52525b);
  }
  .recipient-avatar {
    & img,
    & svg,
    & canvas {
      width: 100%;
      height: 100%;
    }
    & img {
      object-fit: cover;
    }
    & svg {
      display: block;
    }
    & .autoprofilepicture-item {
      width: 100%;
      height: 100%;
    }
  }
  .card-layout {
    --placeholder-margin: 4px;
  }
  /* Compact layout */
  .card-layout[style="height: 60px;"] {
    --placeholder-margin: 1px;
  }
  .card-container > .thread-card-column:first-child:not(:has(.recipient-avatar)) {
    margin-right: calc(var(--recipient-avatar-size) + var(--placeholder-margin));
  }
  .table-layout {
    --recipient-avatar-size: 15px;
    --top-position: calc(50% - 7.5px);
  }
  .table-layout[style="height: 30px;"] {
    --recipient-avatar-size: 20px;
    --top-position: calc(50% - 10px);
  }
  .correspondentcol-column .recipient-avatar {
    position: absolute;
    left: 4.5px;
    top: var(--top-position);
  }
  `;
  if (document.getElementById("auto-profile-picture-style")) {
    return;
  }
  const style = document.createElement("style");

  style.textContent = avatarCss;
  style.id = "auto-profile-picture-style";
  document.head.appendChild(style);
}

/**
 * Uninstalls CSS styles for avatars.
 *
 * @param {Object} window - The window object.
 */
function uninstallCss(window) {
  const { document } = window;
  const style = document.getElementById("auto-profile-picture-style");
  if (style) {
    style.remove();
  }
}

/**
 * Installs an avatar or initials on a given row element of the inbox list.
 *
 * @param {Document} document - The document object.
 * @param {string|Object} urlOrObj - The URL of the avatar image or an object with value and color for initials.
 * @param {HTMLElement} row - The row element where the avatar or initials will be installed.
 * @param {boolean} temporary - A flag indicating whether the avatar is temporary.
 * @returns {Promise<boolean>} - Returns true if the avatar or initials were successfully installed, otherwise false.
 */
async function installOnRow(document, urlOrObj, row, temporary) {
  const tbVersion = getThunderbirdVersion();
  const useCanvas = tbVersion === 145;

  let recipientAvatar = getExtensionRecipientAvatar(row);
  const isNewAvatarElement = !recipientAvatar;
  if (isNewAvatarElement) {
    recipientAvatar = document.createElement("div");
    recipientAvatar.classList.add("recipient-avatar");
    ensureAvatarOwnership(recipientAvatar);
    cacheRecipientAvatar(row, recipientAvatar);
  } else {
    ensureAvatarOwnership(recipientAvatar);
  }
  cleanupDuplicateRecipientAvatars(row, recipientAvatar);

  const normalizedPayload = normalizeAvatarPayload(urlOrObj);
  const url = normalizedPayload.value;
  const initialsColor = normalizedPayload.color;
  const identifier = normalizedPayload.identifier || null;
  const payloadType = determinePayloadType(url);
  let didUpdate = false;

  if (
    shouldSkipAvatarUpdate(recipientAvatar, {
      identifier,
      type: payloadType,
      value: url,
      color: initialsColor,
      isTemporary: temporary && payloadType === "initials",
    })
  ) {
    return false;
  }

  if (payloadType === "empty") {
    return false;
  }

  if (useCanvas) {
    let contactInitials = recipientAvatar.querySelector(".contactInitials");

    if (payloadType === "image") {
      recipientAvatar.classList.add("has-avatar");
      recipientAvatar.classList.remove("no-avatar");

      removeAvatarElements(recipientAvatar);
      const existingInitials =
        recipientAvatar.querySelector(".contactInitials");
      if (existingInitials) {
        existingInitials.remove();
      }

      recipientAvatar.style.background = null;

      const win = document.defaultView || window;
      const size =
        parseInt(win.getComputedStyle(recipientAvatar).width, 10) || 34;
      const canvas = createAvatarCanvas(document, size);
      recipientAvatar.appendChild(canvas);

      await drawDataUrlToCanvas(url, canvas, size, size, win);

      rememberAvatarMetadata(recipientAvatar, {
        identifier,
        type: "image",
        value: url,
      });
      didUpdate = true;
    }

    if (!didUpdate && payloadType === "initials") {
      recipientAvatar.classList.add("no-avatar");
      recipientAvatar.classList.remove("has-avatar");
      recipientAvatar.style.backgroundImage = "";
      removeAvatarElements(recipientAvatar);
      if (!contactInitials) {
        contactInitials = document.createElement("span");
      }
      contactInitials.classList.add("contactInitials");
      contactInitials.classList.add("auto-profile-picture");
      contactInitials.dataset.autoProfilePicture = "true";
      if (!recipientAvatar.contains(contactInitials)) {
        recipientAvatar.appendChild(contactInitials);
      }

      if (initialsColor) {
        recipientAvatar.style.background = initialsColor;
      } else {
        recipientAvatar.style.background = null;
      }
      contactInitials.textContent = extractInitials(url);

      rememberAvatarMetadata(recipientAvatar, {
        identifier,
        type: "initials",
        value: url,
        color: initialsColor,
      });
      didUpdate = true;
    }

    if (!didUpdate) {
      return false;
    }
  } else {
    // TB < 145 and TB 146+: Use img element approach
    let img = recipientAvatar.querySelector(`.${AVATAR_CLASS}`);
    const hasNoImg = !img;
    if (hasNoImg) {
      img = createAvatarImage(document, "", {
        xmlns: "http://www.w3.org/1999/xhtml",
      });
      recipientAvatar.appendChild(img);
    }

    let contactInitials = recipientAvatar.querySelector(".contactInitials");

    if (payloadType === "image") {
      recipientAvatar.classList.add("has-avatar");
      recipientAvatar.classList.remove("no-avatar");
      img.src = url;
      if (contactInitials) {
        recipientAvatar.removeChild(contactInitials);
        recipientAvatar.style.background = null;
      }

      rememberAvatarMetadata(recipientAvatar, {
        identifier,
        type: "image",
        value: url,
      });
      didUpdate = true;
    }

    if (!didUpdate && payloadType === "initials") {
      recipientAvatar.classList.add("no-avatar");
      recipientAvatar.classList.remove("has-avatar");
      removeAvatarElements(recipientAvatar);
      if (!contactInitials) {
        contactInitials = document.createElement("span");
      }
      contactInitials.classList.add("contactInitials");
      contactInitials.classList.add("auto-profile-picture");
      contactInitials.dataset.autoProfilePicture = "true";
      if (!recipientAvatar.contains(contactInitials)) {
        recipientAvatar.appendChild(contactInitials);
      }

      if (initialsColor) {
        recipientAvatar.style.background = initialsColor;
      } else {
        recipientAvatar.style.background = null;
      }
      contactInitials.textContent = extractInitials(url);

      rememberAvatarMetadata(recipientAvatar, {
        identifier,
        type: "initials",
        value: url,
        color: initialsColor,
      });
      didUpdate = true;
    }

    if (!didUpdate) {
      return false;
    }
  }

  if (!didUpdate) {
    return false;
  }

  mountRecipientAvatar(row, recipientAvatar);
  return true;
}

/**
 * Gets the ID of the first row in the thread tree.
 *
 * @param {Map} rows - The rows map.
 * @returns {number} - The ID of the first row.
 */
async function getRowFirstId(rows) {
  try {
    const rowKeys = rows.keys();
    const minimumRowKey = Math.min(...rowKeys);
    const row = rows.get(minimumRowKey);
    return parseInt(row.id.replace("threadTree-row", ""), 10);
  } catch (_error) {}

  try {
    const row = rows[0][1];
    return parseInt(row.id.replace("threadTree-row", ""), 10);
  } catch (_error) {
    return 0;
  }
}

/**
 * Gets the total number of messages in the view.
 *
 * @param {Object} window - The window object.
 * @returns {number} - The total number of messages.
 */
async function getTotalMessagesView(window) {
  const { document } = window;
  try {
    return await window.gFolder.getTotalMessages(false);
  } catch (_e) {
    // Fallback handled below: if getTotalMessages fails, try to get count from DOM.
  }
  try {
    const counter = document.getElementById("threadPaneFolderCount");
    const data = JSON.parse(counter.dataset.l10nArgs);
    return data.count;
  } catch (_e) {
    return 0;
  }
}

/**
 * Removes the avatar from a row element.
 *
 * @param {HTMLElement} row - The row element.
 */
function removeAvatarFromRow(row) {
  if (!row) {
    return;
  }
  const avatars = row.querySelectorAll(EXTENSION_AVATAR_SELECTOR);
  for (const avatar of avatars) {
    avatar.remove();
  }
  if (row[ROW_AVATAR_REFERENCE]) {
    delete row[ROW_AVATAR_REFERENCE];
  }
}

/**
 * Gets the number of expanded dummy rows in the thread tree.
 * Taken from isGroupedByHeaderAtIndex in mail/modules/DBViewWrapper.sys.mjs:2124
 *
 * @param {Object} threadTree - The thread tree object.
 * @param {number} maxIndex - The maximum index to check.
 * @returns {number} - The number of expanded dummy rows.
 */
function getExpandedDummyRowsNumber(threadTree, maxIndex) {
  const MSG_VIEW_FLAG_DUMMY = 0x20000000;
  let dummyRows = 0,
    previousRowDummy = false;
  for (let i = 0; i < maxIndex; i++) {
    if (threadTree._view.getFlagsAt(i) & MSG_VIEW_FLAG_DUMMY) {
      previousRowDummy = true;
    } else {
      if (previousRowDummy) {
        dummyRows++;
      }
      previousRowDummy = false;
    }
  }
  return dummyRows;
}

/**
 * Installs avatars or initials on the inbox list.
 *
 * @param {Object} window - The window object.
 * @param {Array} urls - The array of avatar URLs or initials.
 * @param {Map} rows - The rows map.
 * @param {number} offset - The offset for the rows.
 * @param {boolean} temporary - A flag indicating whether the avatars are temporary.
 * @returns {Promise<Object>} - An object containing the status.
 */
async function installInboxList(window, urls, rows, offset, temporary) {
  const { document } = window;
  let _nbInstalled = 0;

  const threadTree = document.getElementById("threadTree");

  // filter out rows that have data-properties="dummy" and aria-expanded="true" for grouped by sort view
  const removedRows = [];
  rows = new Map([...rows].sort((a, b) => a[0] - b[0]));
  const minRowKey = Math.min(...rows.keys());
  rows = new Map(
    [...rows].filter(([key, value]) => {
      const dataProperties = value.getAttribute("data-properties");
      if (
        dataProperties === "dummy" &&
        value.getAttribute("aria-expanded") === "true"
      ) {
        removedRows.push([key, value]);
        return false;
      }
      if (dataProperties?.includes("imapdeleted")) {
        // filter out deleted rows
        removedRows.push([key, value]);
        return false;
      }
      return true;
    }),
  );

  const removedRowsKeys = removedRows.map(([key, _value]) => key);

  // reindex map keys and includes removed rows
  const hiddenDummyRows = getExpandedDummyRowsNumber(threadTree, minRowKey);

  const indexShift = minRowKey - hiddenDummyRows;

  rows = new Map(
    [...rows].map(([key, value], index) => {
      if (removedRowsKeys.includes(key - 1)) {
        const [, removedRow] = removedRows.find(
          ([index, _value]) => index === key - 1,
        );
        return [index + indexShift, [removedRow, value]];
      }
      return [index + indexShift, value];
    }),
  );

  for (let i = 0; i < urls.length; i++) {
    const currentRow = i + offset;
    const url = urls[i];

    let row = rows.get(currentRow);

    if (Array.isArray(row)) {
      const [removedRow, newRow] = row;
      removeAvatarFromRow(removedRow);
      row = newRow;
    }

    if (!row) {
      continue;
    }

    if (row.getAttribute("data-properties") === "dummy") {
      removeAvatarFromRow(row);
      continue;
    }

    const res = await installOnRow(document, url, row, temporary);

    if (res) {
      _nbInstalled++;
    }
  }
  // console.log("installed", nbInstalled, temporary ? "initials" : "avatars");
  return {
    status: "success",
  };
}

/**
 * Uninstalls the avatars or initials.
 *
 * @param {Object} window - The window object.
 */
function uninstall(window) {
  uninstallCss(window);
}

const _timeoutInitials = null;
const _timeoutInboxList = null;

const EVENTS_TO_LISTEN = [
  "viewchange",
  "rowcountchange",
  "collapsed",
  "expanded",
  "showplaceholder",
  "scroll",
  "change",
  "drop",
  "click",
];
const EVENTS_TABLE_TO_LISTEN = ["thread-changed", "sort-changed"];
const INITIALS_TIMEOUT = 500;
const INBOX_LIST_TIMEOUT = 1000;

/**
 * Handles the installation of initials on the inbox list.
 *
 * @param {Object} window - The window object.
 * @param {Array} payload - The array of initials.
 * @param {Map} rows - The rows map.
 * @param {number} offset - The offset for the rows.
 * @returns {Promise<Object>} - An object containing the status.
 */
async function handleInitials(window, payload, rows, offset) {
  window.clearTimeout(window.timeoutInitials);
  window.timeoutInitials = window.setTimeout(async () => {
    // console.log("initials setTimeout installInboxList call");
    await installInboxList(window, payload, rows, offset, true);
  }, INITIALS_TIMEOUT);

  await installInboxList(window, payload, rows, offset, true);
  return { status: "success" };
}

/**
 * Handles the installation of avatars on the inbox list.
 *
 * @param {Object} window - The window object.
 * @param {Array} payload - The array of avatar URLs.
 * @param {Object} threadTree - The thread tree object.
 * @param {number} offset - The offset for the rows.
 * @returns {Object} - An object containing the status and optional event type.
 */
async function handleInboxList(window, payload, threadTree, offset) {
  window.clearTimeout(window.timeoutInboxList);

  try {
    window.timeoutInboxList = window.setTimeout(async () => {
      await installInboxList(window, payload, threadTree._rows, offset, false);
    }, INBOX_LIST_TIMEOUT);
    await installInboxList(window, payload, threadTree._rows, offset, false);

    // Only setup event listeners for the first rows to avoid multiple concurrent listeners
    if (offset < 15) {
      const eventType = await initializeAllEventListeners(
        threadTree,
        payload.length,
        window,
      );
      await new Promise((resolve) => window.setTimeout(resolve, 100));
      return { status: "needReprint", eventType: eventType };
    } else {
      return { status: "success" };
    }
  } catch (e) {
    console.error(e);
    return { status: "failed", error: e };
  }
}

/**
 * Initializes event listeners on the thread tree.
 *
 * @param {Object} threadTree - The thread tree object.
 * @param {number} payloadLength - The length of the payload.
 * @param {Object} window - The window object.
 * @return {Promise} - A promise that resolves with the event type.
 */
async function initializeAllEventListeners(threadTree, payloadLength, window) {
  const eventsToListen = new Set(EVENTS_TO_LISTEN);
  if (threadTree._rows.length === payloadLength) {
    eventsToListen.delete("scroll");
  }
  const tableThreadTree = threadTree.getElementsByTagName("table")[0];

  const eventType = await Promise.race([
    setupEventListeners(tableThreadTree, EVENTS_TABLE_TO_LISTEN, window),
    setupEventListeners(threadTree, eventsToListen, window),
  ]);
  return eventType;
}

/**
 * Sets up event listeners on the thread tree.
 *
 * @param {Object} threadTree - The thread tree object.
 * @param {Set} eventsToListen - The set of events to listen for.
 * @param {Object} window - The window object.
 * @returns {Promise} - A promise that resolves with the event type.
 */
function setupEventListeners(threadTree, eventsToListen, window) {
  return new Promise((resolve) => {
    const handleEvent = (event) => {
      // console.log("TT resolve", event.type);
      cleanup();
      resolve(event.type);
    };

    const cleanup = () => {
      for (const event of eventsToListen) {
        threadTree.removeEventListener(event, handleEvent);
      }
      observer.disconnect();
    };

    const observer = new window.MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (
          mutation.target.classList.contains("recipient-avatar") ||
          mutation.target.classList.contains("contactInitials") ||
          mutation.target.classList.contains("autoprofilepicture-item")
        ) {
          // mutations caused by the extension
          continue;
        }
        if (
          mutation.type === "childList" &&
          (mutation.removedNodes.length > 0 || mutation.addedNodes.length > 0)
        ) {
          let isAvatarChange = false;
          const nodesToCheck =
            mutation.removedNodes.length > 0
              ? mutation.removedNodes
              : mutation.addedNodes;
          for (const node of nodesToCheck) {
            if (
              node.classList &&
              (node.classList.contains("recipient-avatar") ||
                node.classList.contains("contactInitials"))
            ) {
              isAvatarChange = true;
              break;
            }
          }
          if (isAvatarChange) continue;

          cleanup();
          window.setTimeout(() => {
            resolve("childList");
          }, 300); // WAIT_TIME_MS - 200
          break;
        }
      }
    });
    observer.observe(threadTree, {
      childList: true,
      subtree: true,
      attributes: true,
    });

    for (const event of eventsToListen) {
      threadTree.removeEventListener(event, handleEvent);
      threadTree.addEventListener(event, handleEvent, { once: true });
    }
  });
}

// biome-ignore lint/correctness/noUnusedVariables: Variable name required by the extension API
var headerApi = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    return {
      headerApi: {
        /**
         * Installs avatars on message headers.
         *
         * @param {number} tabId - The tab ID.
         * @param {string} urlJSON - The JSON string containing avatar URLs.
         * @returns {Object} - An object containing the status and optional data or error.
         */
        async pictureHeaders(tabId, urlJSON) {
          const urls = JSON.parse(urlJSON);
          const { nativeTab } = context.extension.tabManager.get(tabId);
          const messageBrowserWindow = getMessageWindow(nativeTab);
          if (messageBrowserWindow) {
            try {
              return await installOnMessageHeader(messageBrowserWindow, urls);
            } catch (e) {
              console.error(e);
              return {
                status: "failed",
                error: e,
              };
            }
          }
          return {
            status: "failed",
            error: "No messageBrowser window found",
          };
        },
        /**
         * Installs avatars in Thunderbird conversation.
         *
         * @param {number} tabId - The tab ID.
         * @param {string} payloadJSON - The JSON string containing payload data.
         * @returns {Object} - An object containing the status and optional data or error.
         */
        async pictureHeadersConversation(tabId, payloadJSON) {
          const payload = JSON.parse(payloadJSON);
          const { nativeTab } = context.extension.tabManager.get(tabId);
          const messageBrowserWindow = getMessageWindow(nativeTab);
          if (messageBrowserWindow) {
            try {
              return await installConversation(messageBrowserWindow, payload);
            } catch (e) {
              console.error(e);
              return {
                status: "failed",
                error: e,
              };
            }
          }
          return {
            status: "failed",
            error: "No messageBrowser window found",
          };
        },
        /**
         * Installs avatars or initials on the inbox list.
         *
         * @param {number} tabId - The tab ID.
         * @param {string} urlJSON - The JSON string containing avatar URLs or initials.
         * @param {number} offset - The offset for the rows.
         * @param {boolean} initials - A flag indicating whether initials are being installed.
         * @returns {Object} - An object containing the status and optional event type.
         */
        async pictureInboxList(
          tabId,
          urlJSON = "{}",
          offset = 0,
          initials = false,
        ) {
          const payload = JSON.parse(urlJSON);
          const { nativeTab } = context.extension.tabManager.get(tabId);
          const window = getContentWindow(nativeTab);
          const threadTree = window.threadTree;

          installCss(window);

          if (initials) {
            return handleInitials(window, payload, threadTree._rows, offset);
          }

          return handleInboxList(window, payload, threadTree, offset);
        },
        /**
         * Gets the ID of the first displayed message in the thread tree.
         *
         * @param {number} tabId - The tab ID.
         * @returns {number} - The ID of the first displayed message.
         */
        async getFirstDisplayedMessageId(tabId) {
          const { nativeTab } = context.extension.tabManager.get(tabId);
          const window = nativeTab.chromeBrowser.contentWindow;
          const threadTree = window.threadTree;
          return await getRowFirstId(threadTree._rows);
        },
        /**
         * Gets the total number of messages in the view.
         *
         * @param {number} tabId - The tab ID.
         * @returns {number} - The total number of messages.
         */
        async getTotalMessagesCount(tabId) {
          const { nativeTab } = context.extension.tabManager.get(tabId);
          const window = nativeTab.chromeBrowser.contentWindow;
          const msgNb = await getTotalMessagesView(window);
          return msgNb;
        },

        /**
         * Installs event listeners on the inbox list.
         *
         * @param {number} tabId - The tab ID.
         */
        async installEventListeners(tabId) {
          const { nativeTab } = context.extension.tabManager.get(tabId);
          const window = getContentWindow(nativeTab);
          const threadTree = window.threadTree;
          const eventType = await initializeAllEventListeners(
            threadTree,
            0,
            window,
          );
          return eventType;
        },
      },
    };
  }

  onShutdown(_isAppShutdown) {
    for (const window of Services.wm.getEnumerator("mail:3pane")) {
      for (const nativeTab of window.gTabmail.tabInfo) {
        const messageBrowserWindow = getMessageWindow(nativeTab);
        if (messageBrowserWindow) {
          uninstall(messageBrowserWindow);
        }
      }
    }

    for (const window of Services.wm.getEnumerator("mail:messageWindow")) {
      const messageBrowserWindow = getMessageWindow(window);
      if (messageBrowserWindow) {
        uninstall(messageBrowserWindow);
      }
    }
  }
};
