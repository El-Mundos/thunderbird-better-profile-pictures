## Roadmap

- Manivest v3 support
- Externalize the CSS in the API to a separate CSS file and inject it using resource:// URLs
- Add automatic retry delay after 30 days when no profile picture is found
- Options to disable and enable sources

## 2.6.0 - Unreleased

First release as Better Profile Pictures, a fork with its own add-on ID: it
installs alongside Auto Profile Picture rather than upgrading it.

### Added

- Configurable provider chain: choose which sources are tried, and in what order
- Privacy modes for online lookups
- Per-sender rules to pin a specific picture or hide one entirely
- User-set cache lifetimes, for both found and not-found pictures
- Avatar shape and initials colour settings
- Rebuilt settings page

### Changed

- The inbox list is no longer re-scanned on every message open
- Inbox-list avatars render from the viewport only, with hard ceilings on rows walked per pass
- Correspondent resolution is memoized per message, and recycled rows repaint from a cache
- Each inbox-list avatar appears as soon as its own lookup finishes, instead of every row waiting for the slowest one; a row is still painted once, with its final picture or initials
- Correspondents at the same domain share its lookups, in flight and, for misses, for the not-found cache lifetime: no more duplicate requests, and each subdomain no longer asks again for its parent domain
- The same address shown under different names is looked up once
- Cached pictures and not-found markers expire after a set time
- Libravatar and the favicon-webpage fallback are no longer in the default lookup chains
- Classes, dataset keys and element ids are namespaced, so the add-on can run next to Auto Profile Picture
- Compatible with Thunderbird 128 to 157

### Fixed

- Runaway folder scan when `firstDisplayedMessageId` was NaN
- `disableCache` is honoured when writing to the cache, not only when reading
- Pictures from domain-level providers are cached once per domain instead of once per address
- The cards view layout also works before Thunderbird 155
- Inbox-list rows that appear while avatars are being looked up, for instance when a folder opens on its selected message, are no longer left blank until the next scroll
- A domain with no logo, or a favicon found for someone else there, no longer keeps a person at that domain from getting their Gravatar; the provider order is followed
- Clearing the cache also drops the pictures and misses held in memory, instead of keeping them until restart

### Security

- SVG pictures are rasterized to PNG before they reach Thunderbird's privileged UI
- Downloaded pictures must be `image/*` and at most 1 MB
- BIMI logo URLs must be HTTPS on a public host name, with no port, credentials or IP address

## 2.5.1 - 2026-09-14

### Fixed

- Fix integration with TB 155

## 2.5.0 - 2026-02-08

### Changed

- Add support for Addy email relay [#24](https://github.com/noam-sc/thunderbird-auto-profile-picture/issues/24) [#25](https://github.com/noam-sc/thunderbird-auto-profile-picture/pull/25)

### Fixed

- Improve avatar rendering and stability [#22](https://github.com/noam-sc/thunderbird-auto-profile-picture/pull/22)

## 2.4.2 - 2025-11-17

### Fixed

- Fix SVG display issue in the inbox list on Thunderbird 145
- Optimize flickering issues in the inbox list

## 2.4.1 - 2025-11-02

### Fixed

- Display issue with delayed IMAP deletion [#14](https://github.com/noam-sc/thunderbird-auto-profile-picture/issues/14)
- Compatibility with Thunderbird 145 and 146+ [#15](https://github.com/noam-sc/thunderbird-auto-profile-picture/issues/15)
- Remove unsafe innerHTML usage in the inbox list

## 2.4.0 - 2025-08-13

### Changed

- Double letters for initials

### Added

- Add support for Proton email relay

## 2.3.0 - 2025-06-22

### Added

- Add support for DuckDuckGo email relay
- Add support for Libravatar

## 2.2.2 - 2025-05-14

### Fixed

- Fix compatibility with Compact Headers extension

## 2.2.1 - 2025-05-03

### Fixed

- Fix compatibility with Thunderbird Conversations extension

## 2.2.0 - 2025-05-01

### Changed

- Minor email list speedup
- Improve display consistency in the inbox list

### Added

- Initials unique background colors for correspondents without profile pictures

### Fixed

- Compatibility with Thunderbird Conversations extension
- Layout change for TB 139

## 2.1.1 - 2025-03-31

### Changed

- Add a fetch rate limit to reduce slowdowns when fetching profile pictures

### Removed

- `webRequest` permission (unused)

## 2.1.0 - 2025-03-09

### Changed

- Improve spacing display in the inbox list when no avatars are displayed yet
- Add web pages favicons on TLD strategy as a fallback
- Improve display stability in the inbox list

## 2.0.0 - 2025-02-27

### Added

- Add 12 localizations
- Support for grouped by sort view (with some performance issues)
- GitHub repository

### Changed

- Huge refactoring, addon size reduced
- Improved performance
- New method to fetch profile pictures using web pages favicons

### Fixed

- Display bug on grouped messages
- Image not saved during contact creation in some cases
- BIMI images not displayed in some cases
- Not found were mishandled in some cases
- Correct detection for Google Drive automatic messages

## 1.3.1 - 2025-02-18

### Fixed

- Fix Gravatar display issue

## 1.3.0 - 2025-02-14

### Changed

- Now uses the recipient's email address to fetch the profile picture in sent folders, instead of the sender's email address.
- Provider icons (e.g., Gmail, Yahoo!) are no longer displayed for personal emails. Currently supports French and international personal emails.

### Fixed

- BIMI icons failed to load in some cases
- Default Gravatar icons were shown in some cases

## 1.2.4 - 2025-01-26

### Fixed

- Extension name wrongly displayed in the settings page
- Several minor optimizations

## 1.2.3 - 2025-01-21

### Fixed

- Fix profile picture not using address book photo when available
- Reduce the number of requests to providers when no photo is available

## 1.2.2 - 2024-09-02

### Fixed

- Fix settings reset when disabling experimental features

## 1.2.1 - 2024-08-27

### Fixed

- Fix inbox list display in table view

## 1.2.0 - 2024-08-27

### Changed

- Disable by default adding a profile picture to contacts when saving them without a photo. This feature can be enabled in the settings.

### Added

- Add profile pictures in inbox list
- Add settings page to enable/disable features, clear cache and test individual email

### Fixed

- Improve speed performance when loading profile pictures

## 1.1.1 - 2024-08-06

### Added

- Add the profile picture when saving a contact without a photo
- Add compatibility with Thunderbird Conversations extension

## 1.1.0 - 2024-08-06

Aborted release due to a bug in Thunderbird developer hub when submitting the new version

## 1.0.1 - 2024-08-02

### Changed

- Remove Experiment API to store picture for Thunderbird native alternative (browser storage)

## 1.0.0 - 2024-08-02

Initial release
