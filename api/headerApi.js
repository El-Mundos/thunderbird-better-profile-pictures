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

const AVATAR_CLASS = "betterprofilepictures-item";
const AVATAR_DATA_QUERY = `[data-better-profile-pictures="true"], .${AVATAR_CLASS}`;
const SVG_DATA_PREFIX = "data:image/svg+xml";
const DEFAULT_FALLBACK_ICON =
  "chrome://messenger/skin/addressbook/icons/contact-generic.svg";
const INITIALS_PREFIX = "//INITIAL:";
const DATA_URL_REGEX = /^data:([^;,]+)(;base64)?,(.*)$/;
const ROW_AVATAR_REFERENCE = Symbol("betterProfilePicturesRowAvatar");
const RECIPIENT_AVATAR_OWNER = "better-profile-pictures";
const EXTENSION_AVATAR_SELECTOR = `.recipient-avatar[data-better-profile-pictures-owner="${RECIPIENT_AVATAR_OWNER}"]`;

function hasInitialsValue(value) {
  return typeof value === "string" && value.includes(INITIALS_PREFIX);
}

function extractInitials(value) {
  return value.replace(INITIALS_PREFIX, "");
}

function markAvatarElement(element) {
  element.classList.add(AVATAR_CLASS);
  element.dataset.betterProfilePictures = "true";
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
  img.alt = attrs.alt || "Profile picture";
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
    element.dataset.betterProfilePicturesOwner = RECIPIENT_AVATAR_OWNER;
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
  const threadCardRow = row.querySelector(".thread-card-row");
  if (threadCardRow) {
    const contentColumn =
      threadCardRow.closest(".thread-card-column") ||
      threadCardRow.parentElement;
    const cardContainer = contentColumn?.parentElement;

    if (cardContainer && contentColumn) {
      if (contentColumn.style.display) {
        contentColumn.style.display = "";
      }
      if (contentColumn.style.flexDirection) {
        contentColumn.style.flexDirection = "";
      }

      // Found through its indicator image rather than the read-status-column
      // class, which only Thunderbird 155 and later set on this column.
      const readStatusColumn = cardContainer
        .querySelector(".read-status")
        ?.closest(".thread-card-column");
      if (readStatusColumn) {
        if (readStatusColumn.style.display) {
          readStatusColumn.style.display = "";
        }
        if (readStatusColumn.style.flexDirection) {
          readStatusColumn.style.flexDirection = "";
        }
      }

      cleanupDuplicateRecipientAvatars(cardContainer, avatar);

      if (
        avatar.parentNode !== cardContainer ||
        avatar.nextElementSibling !== contentColumn
      ) {
        cardContainer.insertBefore(avatar, contentColumn);
      }
      return;
    }
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
    element.dataset.betterProfilePicturesIdentifier = identifier;
  } else {
    delete element.dataset.betterProfilePicturesIdentifier;
  }
  element.dataset.betterProfilePicturesType = type;
  element.dataset.betterProfilePicturesValue = value || "";
  if (color) {
    element.dataset.betterProfilePicturesColor = color;
  } else {
    delete element.dataset.betterProfilePicturesColor;
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
  if (dataset.betterProfilePicturesIdentifier !== identifier) {
    return false;
  }
  const currentType = dataset.betterProfilePicturesType;
  const currentValue = dataset.betterProfilePicturesValue;
  const currentColor = dataset.betterProfilePicturesColor || "";

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
 * @param {string} dataUrl - The data URL to draw
 * @param {HTMLCanvasElement} canvas - The canvas element to draw to
 * @param {number} width - Target width
 * @param {number} height - Target height
 * @param {Window} win - The window object for accessing global functions
 * @returns {Promise<boolean>} - Returns true if successful, false otherwise
 */
async function drawDataUrlToCanvas(dataUrl, canvas, width, height, win) {
  try {
    // SVG is markup, usually written by the sender, and this document is
    // privileged chrome: importing it would let its <style> restyle the whole
    // page. The background rasterizes SVG before sending it, so one reaching
    // here is refused rather than trusted.
    if (isSvgDataUrl(dataUrl)) {
      console.error("Refusing to draw an SVG avatar into a chrome document");
      return false;
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
      const wrongInitials = message.querySelector("abbr.better-profile-pictures");
      if (wrongInitials) {
        wrongInitials.classList.remove("better-profile-pictures");
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
        message.querySelector(".better-profile-pictures");
      if (targetElement) {
        targetElement.classList.remove("contactInitials");
        targetElement.classList.add("contactAvatar");
        targetElement.classList.add("better-profile-pictures");
        targetElement.textContent = "";

        targetElement.style.background = null;

        removeAvatarElements(targetElement);

        const canvas = createAvatarCanvas(document, 32);
        targetElement.appendChild(canvas);

        await drawDataUrlToCanvas(url, canvas, 32, 32, window);
      } else {
        console.error("No contactInitials or better-profile-pictures found");
      }
    } else {
      // TB < 145 and TB 146+: Use background-image approach
      const contactInitials = message.querySelector(".contactInitials");
      if (contactInitials) {
        contactInitials.classList.remove("contactInitials");
        contactInitials.classList.add("contactAvatar");
        contactInitials.classList.add("better-profile-pictures");
        // Clear background color (oklch) when removing initials
        contactInitials.style.background = null;
        contactInitials.style.backgroundImage = `url("${url}")`;
        contactInitials.textContent = "\u00A0";
      } else {
        const avatarElement = message.querySelector(
          ".better-profile-pictures",
        );
        if (avatarElement) {
          // Clear background color (oklch) when removing initials
          avatarElement.style.background = null;
          avatarElement.style.backgroundImage = `url("${url}")`;
          avatarElement.textContent = "\u00A0";
        } else {
          console.error("No contactInitials or better-profile-pictures found");
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
      recipientAvatar.dataset.betterProfilePicturesIdentifier,
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
      contactInitials.classList.add("better-profile-pictures");
      contactInitials.dataset.betterProfilePictures = "true";
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
/**
 * Avatar appearance, mirrored from settings by setAvatarStyle. Held at module
 * scope so every window picks up the current value when its CSS is installed,
 * including windows opened after the setting was changed.
 */
const avatarStyleState = {
  radius: "50%",
};

/**
 * Writes the current appearance onto a window's root element.
 * @param {Object} window - The content window.
 */
function applyAvatarStyle(window) {
  try {
    window.document.documentElement.style.setProperty(
      "--recipient-avatar-radius",
      avatarStyleState.radius,
    );
  } catch (_e) {
    // A window being torn down; nothing to style.
  }
}

function installCss(window) {
  const { document } = window;
  const avatarCss = `
  :root {
    --recipient-avatar-size: 34px;
  }
  .recipient-avatar {
    height: var(--recipient-avatar-size);
    width: var(--recipient-avatar-size);
    min-height: var(--recipient-avatar-size);
    min-width: var(--recipient-avatar-size);
    flex-shrink: 0;
    border-radius: var(--recipient-avatar-radius, 50%);
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
    & .betterprofilepictures-item {
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
  #threadTree[rows="thread-card"] .card-container:has(.recipient-avatar),
  .card-layout .card-container:has(.recipient-avatar) {
    grid-template-columns: auto auto 1fr !important;
  }
  /* The read-status column is matched by its indicator image as well as its
     class: Thunderbird 155 added the class, but the column is the same one
     before it. */
  .card-layout .card-container:has(.recipient-avatar) > :is(.read-status-column, .thread-card-column:has(> .read-status)) {
    grid-column: 1;
    grid-row: 1;
  }
  .card-layout .recipient-avatar {
    grid-column: 2;
    grid-row: 1;
    margin-inline-end: var(--placeholder-margin);
  }
  #threadTree[rows="thread-card"] .card-container:has(.recipient-avatar) > .thread-card-column:not(.read-status-column, :has(> .read-status)),
  #threadTree[rows="thread-card"] .card-container:has(.recipient-avatar) > .thread-card-column:has(.thread-card-row),
  .card-layout .card-container:has(.recipient-avatar) > .thread-card-column:not(.read-status-column, :has(> .read-status)),
  .card-layout .card-container:has(.recipient-avatar) > .thread-card-column:has(.thread-card-row) {
    grid-column: 3;
    grid-row: 1;
  }
  .card-container:not(:has(.recipient-avatar)) > .thread-card-column:not(.read-status-column, :has(> .read-status)),
  .card-container:not(:has(.recipient-avatar)) > .thread-card-column:has(.thread-card-row) {
    margin-inline-start: calc(var(--recipient-avatar-size) + var(--placeholder-margin));
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
  // Applied on every call: the shape is a custom property on the root
  // element, set from the current setting, not part of the stylesheet text.
  applyAvatarStyle(window);
  const existingStyle = document.getElementById("better-profile-pictures-style");
  if (existingStyle) {
    existingStyle.textContent = avatarCss;
    return;
  }
  const style = document.createElement("style");

  style.textContent = avatarCss;
  style.id = "better-profile-pictures-style";
  document.head.appendChild(style);
}

/**
 * Uninstalls CSS styles for avatars.
 *
 * @param {Object} window - The window object.
 */
function uninstallCss(window) {
  const { document } = window;
  const style = document.getElementById("better-profile-pictures-style");
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
      contactInitials.classList.add("better-profile-pictures");
      contactInitials.dataset.betterProfilePictures = "true";
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
      contactInitials.classList.add("better-profile-pictures");
      contactInitials.dataset.betterProfilePictures = "true";
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
  } catch (_error) { }

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
          mutation.target.classList.contains("betterprofilepictures-item")
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

const MSG_VIEW_FLAG_DUMMY = 0x20000000;

/**
 * Returns the per-window main-process cache mapping a message key to its
 * already-resolved avatar payload. This lets us repaint recycled rows (e.g.
 * when scrolling back up) instantly, with no round-trip to the background.
 * @param {Object} window - The content window.
 * @returns {Map<number, Object>}
 */
function getAvatarPaintCache(window) {
  if (!window.__apAvatarPaintCache) {
    window.__apAvatarPaintCache = new Map();
  }
  return window.__apAvatarPaintCache;
}

/**
 * Normalizes a threadTree._rows key to a numeric row index.
 * @param {number|string} key
 * @returns {number}
 */
function toRowIndex(key) {
  return typeof key === "number" ? key : parseInt(key, 10);
}

/**
 * Builds a stable cache key for a message header. messageKey is only unique
 * within a folder, so the folder URI is included to avoid cross-folder
 * collisions.
 * @param {Object} hdr - nsIMsgDBHdr
 * @returns {string}
 */
function msgCacheKey(hdr) {
  const folderUri = hdr.folder?.URI || "";
  return `${folderUri}:${hdr.messageKey}`;
}

/**
 * Repaints every currently-rendered row from the main-process paint cache.
 * Synchronous and cheap (bounded to visible rows); rows whose avatar is
 * unchanged are skipped by installOnRow, so this never flickers. Rows with no
 * cache entry yet (never-seen senders) are left for the background to resolve.
 * @param {Object} window - The content window.
 */
function repaintVisibleFromCache(window) {
  const threadTree = window?.threadTree;
  if (!threadTree || !threadTree._view || !threadTree._rows) {
    return;
  }
  const view = threadTree._view;
  const cache = getAvatarPaintCache(window);
  if (cache.size === 0) {
    return;
  }
  for (const key of threadTree._rows.keys()) {
    const index = toRowIndex(key);
    if (!Number.isInteger(index)) {
      continue;
    }
    try {
      if (view.getFlagsAt && view.getFlagsAt(index) & MSG_VIEW_FLAG_DUMMY) {
        continue;
      }
      const hdr = view.getMsgHdrAt ? view.getMsgHdrAt(index) : null;
      if (!hdr) {
        continue;
      }
      const cached = cache.get(msgCacheKey(hdr));
      if (!cached) {
        continue;
      }
      const row = threadTree._rows.get(key);
      if (row) {
        installOnRow(window.document, cached, row, false);
      }
    } catch (_e) {
      // Skip any row we can't resolve.
    }
  }
}

/**
 * Installs a single persistent scroll + mutation listener per window that
 * repaints visible rows from the paint cache (rAF-debounced). This is the
 * gap-free path that keeps avatars painted while scrolling — especially when
 * scrolling back up into rows Thunderbird recycled and blanked.
 * @param {Object} window - The content window.
 */
function ensurePersistentRepaint(window) {
  if (window.__apPersistentRepaintInstalled) {
    return;
  }
  const threadTree = window?.threadTree;
  if (!threadTree) {
    return;
  }
  window.__apPersistentRepaintInstalled = true;

  let scheduled = false;
  const schedule = () => {
    if (scheduled) {
      return;
    }
    scheduled = true;
    const run = () => {
      scheduled = false;
      repaintVisibleFromCache(window);
    };
    if (window.requestAnimationFrame) {
      window.requestAnimationFrame(run);
    } else {
      window.setTimeout(run, 16);
    }
  };

  threadTree.addEventListener("scroll", schedule, { passive: true });
  const observer = new window.MutationObserver(schedule);
  observer.observe(threadTree, { childList: true, subtree: true });
  window.__apPersistentRepaintObserver = observer;
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
         * Viewport-only: returns the messages for the rows that are currently
         * rendered on screen, read directly from the message view (random
         * access, no folder pagination). Skips grouped/dummy header rows.
         *
         * @param {number} tabId - The tab ID.
         * @returns {Array<{index:number, message:Object}>}
         */
        async getVisibleRowMessages(tabId) {
          const { nativeTab } = context.extension.tabManager.get(tabId);
          const window = getContentWindow(nativeTab);
          const threadTree = window?.threadTree;
          if (!threadTree || !threadTree._view || !threadTree._rows) {
            return [];
          }
          const view = threadTree._view;
          const MSG_VIEW_FLAG_DUMMY = 0x20000000;
          const result = [];
          for (const key of threadTree._rows.keys()) {
            const index = typeof key === "number" ? key : parseInt(key, 10);
            if (!Number.isInteger(index)) {
              continue;
            }
            try {
              if (
                view.getFlagsAt &&
                view.getFlagsAt(index) & MSG_VIEW_FLAG_DUMMY
              ) {
                // Grouped-by-sort header row, not a real message.
                continue;
              }
              const hdr = view.getMsgHdrAt ? view.getMsgHdrAt(index) : null;
              if (!hdr) {
                continue;
              }
              let message;
              try {
                message = context.extension.messageManager.convert(hdr);
              } catch (_e) {
                message = { author: hdr.author || "", recipients: [] };
              }
              result.push({ index, message });
            } catch (_e) {
              // Skip any row we can't resolve.
            }
          }
          return result;
        },

        /**
         * Viewport-only: paints avatars onto the currently rendered rows,
         * keyed by their view index. Bounded to the number of visible rows.
         *
         * @param {number} tabId - The tab ID.
         * @param {string} urlsJSON - JSON map of { rowIndex: urlOrInitialsObj }.
         * @returns {Object} - Status object.
         */
        async paintRowAvatars(tabId, urlsJSON) {
          const urls = JSON.parse(urlsJSON);
          const { nativeTab } = context.extension.tabManager.get(tabId);
          const window = getContentWindow(nativeTab);
          const threadTree = window?.threadTree;
          if (!threadTree || !threadTree._rows) {
            return { status: "failed" };
          }
          installCss(window);
          ensurePersistentRepaint(window);

          const view = threadTree._view;
          const cache = getAvatarPaintCache(window);
          // Keep the cache from growing without bound on very long sessions.
          if (cache.size > 4000) {
            cache.clear();
          }

          for (const [indexStr, url] of Object.entries(urls)) {
            const index = parseInt(indexStr, 10);
            const row = threadTree._rows.get(index);
            if (!row) {
              continue;
            }
            // Cache by the stable message key so we can repaint this row later
            // (after Thunderbird recycles it) without asking the background.
            try {
              const hdr = view?.getMsgHdrAt ? view.getMsgHdrAt(index) : null;
              if (hdr) {
                cache.set(msgCacheKey(hdr), url);
              }
            } catch (_e) {
              // Non-fatal: we just won't have a cache entry for this row.
            }
            try {
              await installOnRow(window.document, url, row, false);
            } catch (e) {
              console.error("paintRowAvatars error", e);
            }
          }
          return { status: "success" };
        },

        /**
         * Sets the avatar appearance for this and all future windows.
         *
         * @param {number} tabId - The tab ID.
         * @param {string} styleJSON - JSON { radius }.
         * @returns {Object} - Status object.
         */
        async setAvatarStyle(tabId, styleJSON) {
          try {
            const style = JSON.parse(styleJSON);
            if (typeof style.radius === "string") {
              avatarStyleState.radius = style.radius;
            }
          } catch (error) {
            console.error("setAvatarStyle: bad payload", error);
            return { status: "failed" };
          }
          try {
            const { nativeTab } = context.extension.tabManager.get(tabId);
            const window = getContentWindow(nativeTab);
            if (window) {
              applyAvatarStyle(window);
            }
          } catch (_e) {
            // No live window yet; the next installCss picks the value up.
          }
          return { status: "success" };
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
