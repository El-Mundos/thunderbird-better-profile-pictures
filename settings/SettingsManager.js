import {
  PrivacyMode,
  reconcileProviderList,
} from "../providers/registry.js";
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
}

export default SettingsManager;
