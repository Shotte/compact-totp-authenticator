# Operator feedback 02: acceptance session with the signed 0.9.2

Confirmed PASS by the operator:
- manual upgrade to 0.9.2;
- the automatic lock after 1 minute;
- A–Z and Z–A sorting in the real toolbar popup;
- the compact layout.

The signed 0.9.2 artifact is unchanged.

## Finding 1 (P1): a text-color change seemed ignored; the text stayed white, also in the preview

**Reproduction.** Browser check F2-1 drives the options form, with these steps:
1. Enable custom colors with a real click.
2. Set the text color to `#ffff00` and the background to `#1e1e1e`. The color inputs receive the `input` and `change` events the native picker fires.
3. Increase the font size with real ArrowRight keys on the slider.
4. Choose row height 30 with a real click.
5. Set the background to `#202020` and the text color to `#66ccff`.
6. Set the text color to `#3366ff`, then to `#ffcc00`.

After each step it checks the stored settings, the preview and the popup.

**Result.** No stale-state defect. After font and row changes, the last valid text color wins in storage, preview and popup: `#66ccff`, later `#ffcc00`.

**Root cause.** The contrast safeguard (`appearance.js` `themeTokens`). If the chosen text color has less than 4.5 : 1 contrast with the background, the popup and the preview use `bestText(bg)` instead. On a dark background that is white.

Many natural picks are affected: `#3366ff`, `#808080` or `#ff0000` on a dark background all become white. The color input keeps showing the chosen color. The old note only said "the text color was adjusted", without naming either color, so the change looked ignored.

**Fix.** The safeguard stays. The note, now styled as a warning, names:
- the chosen color;
- the color actually used;
- the measured contrast ratio and the required minimum;
- what to do.

The choice stays saved, so a later background change can make it valid. Example from F2-1: "Die gewählte Textfarbe #3366ff hat zu wenig Kontrast zum Hintergrund (3,4 : 1, nötig sind mindestens 4,5 : 1). Damit der Text lesbar bleibt, verwendet das Popup #ffffff. …"

## Finding 2 (P2): "Gesperrt. Bitte entsperren." after a recovery with a wrong password

**Reproduction.** Unit level, `importExport` (restore from an encrypted backup):

| Case | Service answer |
|---|---|
| wrong master password | `invalid:current-password` |
| wrong export password | `invalid:import-decrypt` |
| vault not empty | `invalid:vault-not-empty` |
| session expired | `locked:expired` |
| locked | `locked` |

**Root cause.** The wrong password was **not** mapped to `locked`. With the automatic lock at 1 minute, the session expires while the user chooses the file and types two passwords; typing in the form is not activity. The session check comes first, so every attempt then answers `locked`. That answer is correct, but:
- the page showed the generic "Gesperrt. Bitte entsperren.";
- the page stayed in the unlocked view, so the cause was unclear.

**Fix.**
- A session that ended during any password form now switches to the locked view. The top message says that the session expired or was locked, that the action was not carried out, and what to do (`lockedDuringAction`). The session is never extended, and nothing bypasses the fresh master-password check.
- In the restore section:
  - a wrong master password gets its own sentence;
  - a wrong export password or damaged file gets one generic sentence (AES-GCM cannot tell the two apart, by design);
  - a non-empty vault gets its own sentence.
- No new distinction was introduced: these answers already existed.

The locked message is shown at the top, not in the restore section, because the restore section is hidden once the vault is locked. The message names the action that was not carried out.

## Finding 3: sorting

A note under the sort order (German, English) says that sorting applies to the popup display and that the table keeps the manual order. The sorting itself is unchanged.

## Evidence

| Check | Result |
|---|---|
| `npm test` | PASS 223/223 |
| `web-ext lint` | PASS 0/0 |
| Local browser run, Firefox 160.0.1, Windows ([`browser-results-local.json`](browser-results-local.json)) | 98/100 PASS, 2 MANUAL, 0 FAIL. New: F2-1, F2-2 |
| Native Windows color dialog (OS window) | MANUAL_REVIEW: BiDi cannot drive it; F2-1 sends the events it fires |
| Real toolbar popup colors | MANUAL_REVIEW (operator); the popup page itself is checked in F2-1 |
