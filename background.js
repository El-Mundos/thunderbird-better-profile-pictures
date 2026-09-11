import SettingsManager from "./settings/SettingsManager.js";
import Author from "./src/Author.js";
import AvatarService from "./src/AvatarService.js";
import CacheStorage from "./src/CacheStorage.js";
import ContactsService from "./src/ContactsService.js";
import MailService from "./src/MailService.js";
import MessagesService from "./src/MessagesService.js";

const cache = new CacheStorage();
const settingsManager = new SettingsManager(cache);

let inboxListEnabled, contactsIntegrationEnabled;

/**
 * Refreshes the settings from the SettingsManager
 */
async function refreshSettings() {
  inboxListEnabled = await settingsManager.getInboxListEnabled();
  contactsIntegrationEnabled =
    await settingsManager.getContactsIntegrationEnabled();
}
await refreshSettings();

const avatarService = new AvatarService();
const mailService = new MailService(avatarService);
const contactsService = new ContactsService(mailService, avatarService);
const messagesService = new MessagesService(mailService, avatarService);

/**
 * Handles the need for additional data in a tab
 * @param {Object} tab Tab object
 * @param {Object} result Result object containing data
 */
async function handleNeedData(tab, result) {
  const dataPopups = result.data.popupValues;
  const urlsDict = {};
  const seen = new Set();
  for (const popup of dataPopups) {
    const mail = popup.mail;
    if (seen.has(mail)) continue;
    seen.add(mail);
    const author = await Author.fromAuthor(mail);
    const url = await avatarService.getAvatar(author);
    urlsDict[mail] = url;
  }
  const payload = {
    urls: urlsDict,
    data: result.data,
  };
  browser.headerApi.pictureHeadersConversation(tab.id, JSON.stringify(payload));
}

/**
 * Displays avatars in a tab
 * @param {Object} tab Tab object
 * @param {Array} messages Array of message objects
 */
async function displayInTab(tab, messages) {
  let urlsDict = {};
  for (const message of messages) {
    const urls = await mailService.getUrl(message, "messageHeader");
    urlsDict = { ...urlsDict, ...urls };
  }
  const urlDictJSON = JSON.stringify(urlsDict);
  const result = await browser.headerApi.pictureHeaders(tab.id, urlDictJSON);

  if (result.status === "needData") {
    handleNeedData(tab, result);
  }
}

/**
 * Handles the creation of a new contact
 * @param {Object} contactNode Contact node object
 */
async function onContactCreated(contactNode) {
  if (!contactsIntegrationEnabled) return;
  await contactsService.handleContactCreated(contactNode);
}

/**
 * Displays the inbox list in a tab
 * @param {Object} tab Tab object
 */
async function displayInboxList(tab) {
  if (!inboxListEnabled) return;
  try {
    await messagesService.displayInboxList(tab);
  } catch (error) {
    console.warn("Error in displayInboxList:", error);
  }
}

/**
 * Initializes event listeners
 */
function initListeners() {
  browser.messageDisplay.onMessageDisplayed.addListener(
    async (tab, message) => {
      // Decorate the opened message's header only. The inbox list is already
      // decorated and is kept in sync by folder-change / DOM-list events, so we
      // deliberately do NOT trigger a full inbox-list re-scan on every message
      // open — that was re-scanning the whole (potentially huge) folder on
      // every click.
      displayInTab(tab, [message]);
    },
  );

  browser.messageDisplay.onMessagesDisplayed.addListener(
    async (tab, messages) => {
      displayInTab(tab, messages);
    },
  );

  browser.mailTabs.onDisplayedFolderChanged.addListener((tab) => {
    displayInboxList(tab);
  });

  browser.messages.onNewMailReceived.addListener(async (_folder, _messages) => {
    setTimeout(async () => {
      const currentTab = await browser.tabs.getCurrent();
      displayInboxList(currentTab);
    }, 1000);
  });

  browser.tabs.onUpdated.addListener(async (_tabId, _changeInfo, tab) => {
    if (tab.type !== "mail") {
      return;
    }
    displayInboxList(tab);
  });

  browser.runtime.onMessage.addListener(async (message, _sender) => {
    if (message.action === "displayInboxList") {
      displayInboxList();
    } else if (message.action === "refreshSettings") {
      refreshSettings();
      // Invalidated here rather than inside refreshSettings(): that also runs
      // at startup, before avatarService is constructed.
      avatarService.invalidateSettings();
    }
  });

  messenger.contacts.onCreated.addListener(onContactCreated);

  browser.tabs.onUpdated.addListener(async (tabId, _changeInfo, tab) => {
    if (tab.status === "complete" && tab.type === "special") {
      // Thunderbird Conversations tab
      const result = await browser.headerApi.pictureHeaders(tabId, "{}");
      if (result.status === "needData") {
        handleNeedData(tab, result);
      }
    }
  });
}

initListeners();
if (inboxListEnabled) {
  displayInboxList();
}
