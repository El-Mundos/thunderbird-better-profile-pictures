import { shapeToRadius } from "../providers/registry.js";
import defaultSettings from "../settings/defaultSettings.js";
import Author from "./Author.js";

/**
 * Service for handling messages and their associated avatars.
 */
class MessagesService {
  constructor(mailService, avatarService) {
    this.mailService = mailService;
    this.avatarService = avatarService;
    this.WAIT_TIME_MS = defaultSettings.WAIT_TIME_MS;
    // How long a settled avatar waits for others to share its paint. Short
    // enough to go unnoticed, long enough to gather the cache hits of a pass.
    this.PAINT_BATCH_MS = 30;
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
   * @param {Array<string>|null} [attemptedKeys=null] - Messages the pass just
   *   resolved. When given, rows that appeared outside them during the pass
   *   start the next pass at once instead of waiting for another event.
   * @returns {Promise<void>}
   */
  async installDOMlistener(tabId, attemptedKeys = null) {
    const eventType = await browser.headerApi.installEventListeners(
      tabId,
      attemptedKeys ? JSON.stringify(attemptedKeys) : undefined,
    );
    if (eventType === "stale") {
      // Those rows have already waited for a whole pass.
      this.lastDisplayInboxListCall = 0;
    } else if (eventType === "scroll") {
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
    await this.displayVisibleRows(currentProcessId, tab);
  }

  /**
   * Builds the paint payload for one inbox-list row: the avatar if one is
   * found, otherwise initials.
   * @param {Author} author - The row's correspondent.
   * @returns {Promise<Object>} - The payload for paintRowAvatars.
   */
  async getRowPayload(author) {
    const identifier = author.getEmail() || author.getAuthor() || "";
    try {
      const url = await this.avatarService.getAvatar(author);
      if (url && typeof url === "object") {
        return {
          value: url.value ?? "",
          color: url.color ?? null,
          identifier: url.identifier || identifier,
        };
      }
      if (url) {
        return { value: url, identifier };
      }
    } catch (_e) {
      // Fall through to initials.
    }
    return await this.avatarService.buildInitials(author);
  }

  /**
   * Viewport-only inbox-list decoration.
   *
   * Instead of walking the whole folder to map avatars to global message
   * offsets, this reads ONLY the rows currently rendered on screen (bounded to
   * ~a few dozen regardless of folder size), starts resolving their avatars,
   * and re-arms a listener straight away so the next scroll / view change
   * reads the new set of visible rows while those lookups are still painting.
   * This is what makes big folders fast.
   *
   * @param {number} currentProcessId - Guards against overlapping runs.
   * @param {Object} tab - The tab object (may be null).
   */
  async displayVisibleRows(currentProcessId, tab) {
    const tabId = await this.getMailTabId(tab);

    // Push the configured shape before painting. Cheap (two property writes)
    // and it keeps windows opened after a settings change in step.
    const { shape } = await this.avatarService.getAppearance();
    await browser.headerApi.setAvatarStyle(
      tabId,
      JSON.stringify({ radius: shapeToRadius(shape) }),
    );

    const rows = await browser.headerApi.getVisibleRowMessages(tabId);
    if (currentProcessId !== this.processId) {
      return;
    }

    // Resolve each visible row's correspondent (memoized, cheap).
    const resolved = (
      await Promise.all(
        rows.map(async ({ key, message }) => {
          try {
            const author = await this.mailService.getCorrespondent(
              message,
              "inboxList",
            );
            return { key, author };
          } catch (_e) {
            return null;
          }
        }),
      )
    ).filter(Boolean);

    if (currentProcessId !== this.processId) {
      return;
    }

    // Each row is painted as soon as its own lookup settles, so a slow source
    // delays only the rows waiting on it, not the cached ones beside them. A
    // row is still painted once, with its final value (the avatar if one is
    // found, otherwise initials), never initials first and a picture later.
    // Results settling close together are sent in one paint.
    //
    // A newer pass does not cancel these paints. They are keyed by message,
    // so a late one lands on its row if it is still rendered and is only
    // cached if not, and dropping it would throw away a finished lookup.
    let batch = {};
    let flushTimer = null;
    let painting = Promise.resolve();
    const flush = () => {
      flushTimer = null;
      const payload = JSON.stringify(batch);
      batch = {};
      painting = painting.then(async () => {
        try {
          await browser.headerApi.paintRowAvatars(tabId, payload);
        } catch (error) {
          console.warn("Error painting inbox-list avatars:", error);
        }
      });
    };
    Promise.all(
      resolved.map(async ({ key, author }) => {
        // Awaited on its own line: `batch[key] = await ...` would bind the
        // batch before the lookup, and write into one already sent.
        const payload = await this.getRowPayload(author);
        batch[key] = payload;
        flushTimer ??= setTimeout(flush, this.PAINT_BATCH_MS);
      }),
    )
      .then(() => {
        if (flushTimer !== null) {
          clearTimeout(flushTimer);
          flush();
        }
      })
      .catch((error) => {
        console.warn("Error resolving inbox-list avatars:", error);
      });

    // Re-arm without waiting for the lookups: block until the next relevant
    // view change (scroll, folder change, sort, row recycle), then read the
    // new visible set. Waiting for them let one slow sender deafen the list,
    // so rows scrolled into view stayed blank until something unrelated, such
    // as a click, started a pass. Lookups already running are shared by
    // AvatarService, so the next pass does not fetch them again. Rows that
    // changed while this one was being read start the next pass at once.
    if (currentProcessId !== this.processId) {
      return;
    }
    await this.installDOMlistener(
      tabId,
      rows.map(({ key }) => key),
    );
  }
}

export default MessagesService;
