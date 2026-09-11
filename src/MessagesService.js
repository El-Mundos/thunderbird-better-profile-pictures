import defaultSettings from "../settings/defaultSettings.js";
import Author from "./Author.js";
import RecipientInitial from "./RecipientInitial.js";

/**
 * Service for handling messages and their associated avatars.
 */
class MessagesService {
  constructor(mailService, avatarService) {
    this.mailService = mailService;
    this.avatarService = avatarService;
    this.WAIT_TIME_MS = defaultSettings.WAIT_TIME_MS;
    this.SUBBATCH_SIZE = defaultSettings.SUBBATCH_SIZE;
    /**
     * Timestamp of the last display inbox list call.
     */
    this.lastDisplayInboxListCall = 0;
    this.isPending = false;
    this.pendingTab = null;
    this.pendingTriggeredFromDOMEvent = false;
    this.processId = 0;
  }

  /**
   * Checks if the inbox list can be displayed.
   * @returns {boolean} - True if the inbox list can be displayed, false otherwise.
   */
  canDisplayInboxList() {
    return Date.now() - this.lastDisplayInboxListCall >= this.WAIT_TIME_MS;
  }

  /**
   * Updates the timestamp of the last inbox list display call.
   */
  updateLastDisplayInboxListCall() {
    this.lastDisplayInboxListCall = Date.now();
  }

  /**
   * Maps messages to their correspondents.
   * @param {Array} messages - The list of messages.
   * @returns {Promise<Array<Author>>} - The list of correspondents (Author objects).
   */
  async mapMessagesToCorrespondents(messages) {
    const correspondents = await Promise.all(
      messages.map(async (message) => {
        return await this.mailService.getCorrespondent(message);
      }),
    );
    return correspondents;
  }

  /**
   * Fetches avatars for the given messages.
   * @param {Array} messages - The list of messages.
   * @returns {Promise<Array>} - The list of avatar URLs.
   */
  async fetchAvatarsFromMessages(messages) {
    const messagesAuthorsSet = await this.getMessagesAuthorsSet(messages);
    const urls = {};

    const avatarPromises = Array.from(messagesAuthorsSet).map(
      async (author) => {
        const identifier = author.getEmail() || author.getAuthor() || "";
        const url = await this.avatarService.getAvatar(author);

        if (url && typeof url === "object") {
          urls[author] = {
            value: url.value ?? "",
            color: url.color ?? null,
            identifier: url.identifier || identifier,
          };
          return;
        }

        if (url) {
          urls[author] = {
            value: url,
            identifier,
          };
          return;
        }

        urls[author] = RecipientInitial.buildInitials(author);
      },
    );

    await Promise.all(avatarPromises);

    return this.mapMessagesToCorrespondents(messages).then((correspondents) => {
      return correspondents.map((correspondent) => urls[correspondent]);
    });
  }

  /**
   * Retrieves initials for the given messages.
   * @param {Array} messages - The list of messages.
   * @returns {Promise<Array<string>>} - The list of initials.
   */
  async getInitialsFromMessages(messages) {
    const messagesAuthorsSet = await this.getMessagesAuthorsSet(messages);
    const initials = {};

    await Promise.all(
      Array.from(messagesAuthorsSet).map(async (author) => {
        initials[author] = RecipientInitial.buildInitials(author);
      }),
    );

    return await this.mapMessagesToCorrespondents(messages).then(
      (correspondents) => {
        return correspondents.map((correspondent) => initials[correspondent]);
      },
    );
  }

  /**
   * Retrieves a set of authors from the given messages.
   * @param {Array} messages - The list of messages.
   * @returns {Promise<Set<Author>>} - The set of authors (Author objects).
   */
  async getMessagesAuthorsSet(messages) {
    return new Set(
      await this.mapMessagesToCorrespondents(messages).then(
        (correspondents) => {
          return correspondents;
        },
      ),
    );
  }

  /**
   * Displays initials for the given messages.
   * @param {Array} messages - The list of messages.
   * @param {number} tabId - The tab ID.
   * @param {number} offset - The offset.
   */
  async displayInitials(messages, tabId, offset) {
    const initials = await this.getInitialsFromMessages(messages);
    browser.headerApi.pictureInboxList(
      tabId,
      JSON.stringify(initials),
      offset,
      true,
    );
  }

  /**
   * Displays avatars for the given messages.
   * @param {Array} messages - The list of messages.
   * @param {number} tabId - The tab ID.
   * @param {number} offset - The offset.
   * @param {Function} resolve - The resolve function for the promise.
   */
  async displayAvatars(messages, tabId, offset, resolve) {
    const urls = await this.fetchAvatarsFromMessages(messages);
    resolve();

    const result = await browser.headerApi.pictureInboxList(
      tabId,
      JSON.stringify(urls),
      offset,
      false,
    );
    if (result.status === "needReprint") {
      if (result.eventType === "scroll") {
        this.lastDisplayInboxListCall -= this.WAIT_TIME_MS / 2;
      }
      await this.displayInboxList(null, true);
    }
  }

  /**
   * Retrieves the next set of messages.
   * @param {Object} currentMessages - The current set of messages.
   * @returns {Promise<Object>} - The next set of messages.
   */
  async getNextMessages(currentMessages) {
    return await browser.messages.continueList(currentMessages.id);
  }

  /**
   * Processes the next set of messages.
   * @param {Object} currentMessages - The current set of messages.
   * @param {number} tabId - The tab ID.
   * @param {number} offset - The offset.
   */
  async processNextMessages(currentMessages, tabId, offset, processId) {
    const page = await this.getNextMessages(currentMessages);
    const newOffset = offset + currentMessages.messages.length;
    this.processMessagesInboxList(
      page,
      tabId,
      newOffset,
      await browser.headerApi.getFirstDisplayedMessageId(tabId),
      processId,
    );
  }

  /**
   * Processes the inbox list of messages.
   * @param {Object} currentMessages - The current set of messages.
   * @param {number} tabId - The tab ID.
   * @param {number} messagesOffset - The offset for the messages.
   * @param {number} firstDisplayedMessageId - The ID of the first displayed message.
   * @param {number} processId - The process ID.
   */
  async processMessagesInboxList(
    currentMessages,
    tabId,
    messagesOffset,
    firstDisplayedMessageId,
    processId,
  ) {
    if (processId !== this.processId) {
      return;
    }
    const hasNextMessages = (currentMessages) =>
      currentMessages.id !== null && currentMessages.id !== undefined;

    const fetchAllMessages = async (
      currentMessages,
      maxMessages,
      messagesOffset,
    ) => {
      let allMessages = [];
      while (
        hasNextMessages(currentMessages) &&
        allMessages.length + messagesOffset < maxMessages
      ) {
        if (processId !== this.processId) {
          return { messages: [], id: null };
        }
        allMessages = allMessages.concat(currentMessages.messages);
        currentMessages = await this.getNextMessages(currentMessages);
      }
      allMessages = allMessages.concat(currentMessages.messages);
      return { messages: allMessages, id: currentMessages.id };
    };

    if (currentMessages.messages.length === 0) {
      return;
    }
    if (
      firstDisplayedMessageId &&
      firstDisplayedMessageId > currentMessages.messages.length + messagesOffset
    ) {
      const messages = await fetchAllMessages(
        currentMessages,
        firstDisplayedMessageId,
        messagesOffset,
      );
      if (processId !== this.processId) {
        return;
      }
      currentMessages = messages;
      const priorityMessagesList = currentMessages.messages.slice(
        firstDisplayedMessageId,
      );
      const priorityMessages = {
        messages: priorityMessagesList,
        id: currentMessages.id,
      };
      await this.processBatch(
        priorityMessages,
        tabId,
        messagesOffset + firstDisplayedMessageId,
      );

      if (hasNextMessages(currentMessages)) {
        this.processNextMessages(
          currentMessages,
          tabId,
          messagesOffset + currentMessages.messages.length,
          processId,
        );
      }

      // We don't process previous messages to avoid performance issues when scrolling down
      /*
      let index = firstDisplayedMessageId - this.SUBBATCH_SIZE;
      while (index >= 0) {
        let previousMessagesList = currentMessages.messages.slice(index, index + this.SUBBATCH_SIZE);
        let previousMessages = {
          messages: previousMessagesList,
          id: currentMessages.id,
        };
        await this.processBatch(previousMessages, tabId, messagesOffset + index);
        index -= this.SUBBATCH_SIZE;
      }
      */

      if (firstDisplayedMessageId >= this.SUBBATCH_SIZE) {
        await this.installDOMlistener(tabId);
      }
      return;
    }

    await this.processBatch(currentMessages, tabId, messagesOffset);

    if (hasNextMessages(currentMessages)) {
      // Stop processing if we have covered the visible area plus a buffer
      const VISIBLE_BUFFER = 50;
      if (
        firstDisplayedMessageId !== undefined &&
        messagesOffset + currentMessages.messages.length >
          firstDisplayedMessageId + VISIBLE_BUFFER
      ) {
        await this.installDOMlistener(tabId);
        return;
      }
      this.processNextMessages(
        currentMessages,
        tabId,
        messagesOffset,
        processId,
      );
    }
  }

  /**
   * Processes a batch of messages.
   * @param {Object} currentMessages - The current set of messages.
   * @param {number} tabId - The tab ID.
   * @param {number} messagesOffset - The offset for the messages.
   * @returns {Promise<boolean>} - True when the batch is processed.
   */
  async processBatch(currentMessages, tabId, messagesOffset) {
    const subbatches = [];
    for (
      let i = 0;
      i < currentMessages.messages.length;
      i += this.SUBBATCH_SIZE
    ) {
      const subbatch = currentMessages.messages.slice(
        i,
        i + this.SUBBATCH_SIZE,
      );
      subbatches.push(
        this.processSubbatch(subbatch, tabId, messagesOffset + i),
      );
    }
    await Promise.all(subbatches);
    return true;
  }

  /**
   * Processes a subbatch of messages.
   * @param {Array} subbatch - The subbatch of messages.
   * @param {number} tabId - The tab ID.
   * @param {number} subbatchOffset - The offset for the subbatch.
   * @returns {Promise<void>}
   */
  async processSubbatch(subbatch, tabId, subbatchOffset) {
    return new Promise((resolve) => {
      this.displayAvatars(subbatch, tabId, subbatchOffset, resolve);
    });
  }

  /**
   * Retrieves messages and the tab ID.
   * @param {Object} tab - The tab object.
   * @returns {Promise<{currentMessages: Object, tabId: number, firstDisplayedMessageId: number}>} - The messages and tab ID.
   */
  async getMessagesAndTabId(tab) {
    const tabId = await this.getMailTabId(tab);

    const currentMessages = await browser.mailTabs.getListedMessages(tabId);
    const firstDisplayedMessageId =
      await browser.headerApi.getFirstDisplayedMessageId(tabId);

    return { currentMessages, tabId, firstDisplayedMessageId };
  }

  /**
   * Retrieves the mail tab ID.
   * @param {Object} tab - The tab object.
   * @returns {Promise<number>} - The mail tab ID.
   * @throws {Error} - If the tab is not a mail tab.
   */
  async getMailTabId(tab) {
    let tabId = 1;
    if (!tab) {
      const mailTabs = await browser.tabs.query({ mailTab: true });
      if (mailTabs.length > 0) {
        tabId = mailTabs[0].id;
      }
    } else if (tab.type !== "mail") {
      throw new Error(`Not a mail tab ${tab.type}`);
    } else {
      tabId = tab.id;
    }
    return tabId;
  }

  /**
   * Installs DOM listeners for the given tab ID.
   * @param {number} tabId - The tab ID.
   * @returns {Promise<void>}
   */
  async installDOMlistener(tabId) {
    const eventType = await browser.headerApi.installEventListeners(tabId);
    if (eventType === "scroll") {
      this.lastDisplayInboxListCall -= this.WAIT_TIME_MS / 2;
    }
    await this.displayInboxList(null, true);
  }

  /**
   * Displays avatars on the inbox list.
   * @param {Object} tab - The tab object.
   * @param {boolean} triggeredFromDOMEvent - Indicates if the call was triggered from a DOM event.
   */
  async displayInboxList(tab, triggeredFromDOMEvent = false) {
    if (!this.canDisplayInboxList()) {
      this.pendingTab = tab;
      this.pendingTriggeredFromDOMEvent = triggeredFromDOMEvent;
      if (this.isPending) {
        return;
      }
      this.isPending = true;
      const remainingTime =
        this.WAIT_TIME_MS - (Date.now() - this.lastDisplayInboxListCall);
      setTimeout(
        () => {
          this.isPending = false;
          this.displayInboxList(
            this.pendingTab,
            this.pendingTriggeredFromDOMEvent,
          );
        },
        Math.max(0, remainingTime),
      );
      return;
    }
    this.updateLastDisplayInboxListCall();
    this.processId++;
    const currentProcessId = this.processId;
    const { currentMessages, tabId, firstDisplayedMessageId } =
      await this.getMessagesAndTabId(tab);
    await this.processMessagesInboxList(
      currentMessages,
      tabId,
      0,
      firstDisplayedMessageId,
      currentProcessId,
    );
  }
}

export default MessagesService;
