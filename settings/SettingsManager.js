import {
  PrivacyMode,
  reconcileProviderList,
} from "../providers/registry.js";
import { sanitizeOverrides } from "../src/DomainOverrides.js";
import defaultSettings from "./defaultSettings.js";

class SettingsManager {
  constructor(cache) {
    this.cache = cache;
  }

  async getSetting(settingName) {
    let value = await this.cache.getProperty(`SETTINGS_${settingName}`);
    if (value === null) {
      value = defaultSettings[settingName];
      await this.setSetting(settingName, value);
    }
    return value;
  }

  async setSetting(settingName, value) {
    await this.cache.setProperty(`SETTINGS_${settingName}`, value);
  }

  async getInboxListEnabled() {
    return this.getSetting("inboxListEnabled");
  }

  async setInboxListEnabled(value) {
    await this.setSetting("inboxListEnabled", value);
  }

  async getContactsIntegrationEnabled() {
    return this.getSetting("contactsIntegrationEnabled");
  }

  async setContactsIntegrationEnabled(value) {
    await this.setSetting("contactsIntegrationEnabled", value);
  }

  /**
   * Returns the provider lookup chain, reconciled against the registry so a
   * list stored by an older release stays usable.
   * @returns {Promise<Array<{id: string, enabled: boolean}>>}
   */
  async getProviders() {
    return reconcileProviderList(await this.getSetting("providers"));
  }

  async setProviders(value) {
    await this.setSetting("providers", reconcileProviderList(value));
  }

  /**
   * Returns the active privacy mode, falling back to the default if storage
   * holds a value from a release that defined different modes.
   * @returns {Promise<string>} A PrivacyMode value.
   */
  async getPrivacyMode() {
    const mode = await this.getSetting("privacyMode");
    return Object.values(PrivacyMode).includes(mode)
      ? mode
      : defaultSettings.privacyMode;
  }

  async setPrivacyMode(value) {
    await this.setSetting("privacyMode", value);
  }

  /**
   * Returns how long saved pictures and "no picture" results stay valid.
   * @returns {Promise<{foundDays: number, notFoundDays: number}>}
   */
  async getCacheRefreshDays() {
    return {
      foundDays: await this.getSetting("cacheRefreshFoundDays"),
      notFoundDays: await this.getSetting("cacheRefreshNotFoundDays"),
    };
  }

  async setCacheRefreshFoundDays(value) {
    await this.setSetting("cacheRefreshFoundDays", value);
  }

  async setCacheRefreshNotFoundDays(value) {
    await this.setSetting("cacheRefreshNotFoundDays", value);
  }

  /**
   * Returns the avatar appearance settings.
   * @returns {Promise<{shape: string, initialsColor: string}>}
   */
  async getAppearance() {
    return {
      shape: await this.getSetting("avatarShape"),
      initialsColor: await this.getSetting("initialsColor"),
    };
  }

  async setAvatarShape(value) {
    await this.setSetting("avatarShape", value);
  }

  async setInitialsColor(value) {
    await this.setSetting("initialsColor", value);
  }

  /**
   * Returns the per-sender rules, sanitised so callers never see a
   * half-finished entry.
   * @returns {Promise<Array<Object>>}
   */
  async getDomainOverrides() {
    return sanitizeOverrides(await this.getSetting("domainOverrides"));
  }

  async setDomainOverrides(value) {
    await this.setSetting("domainOverrides", sanitizeOverrides(value));
  }
}

export default SettingsManager;
