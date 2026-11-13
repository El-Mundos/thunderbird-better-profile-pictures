# ATN listing text

Paste into the Developer Hub. The **Privacy Policy** field takes the full text
of `PRIVACY.md` (ATN does not accept a link).

## Name

Better Profile Pictures

## Summary (250 characters max)

Shows a picture for every sender: their photo, their organisation's logo, or
their initials. Fast on large folders, with full control over which online
sources are asked and what each one learns.

## Categories

Message and News Reading · Appearance

## Description

ATN renders neither Markdown nor hard wraps: it allows a few HTML tags (`<b>`,
`<i>`, `<ul>`, `<li>`, `<a>`...) and turns every newline into a line break. So
each paragraph below is one line, and lists stay on a single line to avoid
stray breaks between items. Paste the block as is.

```html
Better Profile Pictures puts a face next to your mail: in the message header and, if you like, in the message list, in both the table and the cards view.

<b>Where the pictures come from</b>
<ol><li>Photos in your address books.</li><li>Online sources, in an order you choose: the brand logo an organisation publishes through BIMI, Gravatar photos, and DuckDuckGo site icons are on by default; Libravatar, Google, Icon Horse, Splitbee and a site favicon lookup can be switched on.</li><li>Initials in a colour derived from the address, when nothing is found.</li></ol>
<b>Built for large folders.</b> Only the rows on screen are looked up, each sender once, with results cached and reused as you scroll.

<b>Your choice of what gets sent.</b> Online lookups send the sender's domain, or a SHA-256 hash of their address, to the source being asked; never message content and never your own address. Turn sources on and off one by one, or pick a privacy mode:
<ul><li><i>Off</i>: every enabled source.</li><li><i>Balanced</i>: BIMI only, so no picture service learns who you correspond with.</li><li><i>Strict</i>: no network requests at all; address book photos and initials only.</li></ul>
<b>Per-sender rules.</b> Pin a specific picture for a sender or a whole domain, or hide it.

<b>Also:</b> circle, rounded or square avatars; configurable cache lifetimes; optional photos for newly created contacts.

Better Profile Pictures started as a fork of Auto Profile Picture by Noam SCHMITT, whose work it builds on under the Mozilla Public License 2.0.
Source code: <a href="https://github.com/El-Mundos/thunderbird-better-profile-pictures">github.com/El-Mundos/thunderbird-better-profile-pictures</a>
```
