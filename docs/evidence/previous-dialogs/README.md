# #25 V2 §7: previous vault state – visual and keyboard review (PR #38)

PR #38 replaces the checkbox form for the kept previous vault state:
- the master password is entered once in the box;
- each action opens one modal dialog with the focus on Cancel;
- discarding is labelled as irreversible and styled as destructive.

The operator approved the design in principle and asked for a final visual and
accessibility review in real Firefox before the merge. This directory holds that review.

All data is synthetic. Nothing was signed, tagged or published.

## Environment

- Windows 11, Firefox **160.0.1** (release, German build).
- A visible window and throwaway profiles.
- The English run requested `en-US`; the extension reported UI language `en-US`.
- Script: [`test/browser/previous-dialogs-review.mjs`](../../../test/browser/previous-dialogs-review.mjs) (`--lang=de|en`).
  - **Zoom:** real browser zoom (`ZoomManager` on the tab's browser, checked through
    `devicePixelRatio` 1/1.5/2), not CSS zoom.
  - **Window size:** the real window is resized.
  - **Themes:** light and dark through `prefers-color-scheme`.
  - **Input:** keyboard and mouse through WebDriver input actions.

## Results

| Check | What it covers | de | en |
|---|---|---|---|
| V-1 | Both dialogs at 1280 and 520 px window width × real zoom 100/150/200 % × light/dark (24 combinations): dialog opens, nothing clipped, no horizontal overflow of page or dialog, confirm button reachable, contrast ≥ 4.5:1 for text and both buttons | PASS | PASS |
| V-2 | Restore text names both counts (current 3, previous 2), the date, and that nothing is lost. Discard text names date, count, and that it cannot be undone. Discard confirm is filled red in both themes; restore confirm is the primary button | PASS | PASS |
| K-1 | Keyboard only (see below) | PASS | PASS |
| A-1 | `alertdialog` with label and description; all buttons named; password field labelled; no checkbox | PASS | PASS |
| F-1 | Wrong master password (see below) | PASS | PASS |
| D-1 | Real double click on the confirm button (see below) | PASS | PASS |
| C-1 | An entry added from another tab while the restore dialog is open: no entry is lost; the changed state becomes the previous state | PASS | PASS |
| F-2 | Discard through the dialog: copy deleted, box closes, exactly one visible message, current entries unchanged | PASS | PASS |
| Suite | `browser-results-local.json`, including P-1 | 110/113 PASS, 0 FAIL, 2 MANUAL, 1 NOT_TESTED (as on `main`) | – |
| Unit | `npm test`, including the restore and discard cases in `replace.test.mjs` | 249/249 PASS | – |
| Lint | `web-ext lint` | 0 errors, 0 warnings | – |

**K-1 (keyboard only):**
- Tab moves to the button, and Enter opens the dialog.
- The focus starts on Cancel with a visible 2 px focus ring.
- Tab reaches the confirm button, with the ring visible.
- Shift+Tab returns to Cancel.
- Escape closes the dialog and returns the focus to the button that opened it.

**F-1 (wrong master password):**
- Neither vault state changes (entries, date and count of the copy).
- Exactly one visible message appears, directly below the buttons and in view, with no
  `role=alert`.
- The field is cleared, focused and marked `aria-invalid`.
- The box has no other inputs, so nothing has to be selected again.

**D-1 (real double click on the confirm button):**
- The swap runs once.
- The dialog stays closed.
- Exactly one success message appears, in view.
- The focus returns to the restore button.

### Fixed during this review (in PR #38)

1. **Contrast of the destructive button.**
   - Red text on the grey button background reached only 4.33:1 (light) and 3.96:1 (dark).
     This also affected "Ersetzen" in the replacement dialog from PR #37.
   - Fix: `.danger` buttons are now filled with `--err` and use text in `--bg`. That gives
     5.36:1 (light) and 5.10:1 (dark), and they now stand apart from Cancel more clearly.
2. **Horizontal scrolling in narrow windows at 200 % zoom** (520 px window, 252 CSS px).
   - The dialogs themselves did not overflow; the page beneath them did.
   - Causes: the file pickers (content-box width plus padding) and the button row of the box,
     which did not wrap.
   - Fixes: file inputs use `max-width: 100%` with `border-box`; `.actions` rows wrap.
   - This was already present on `main`; it showed only below about 320 CSS px.
3. **Focus after a successful restore.**
   - The focus fell on the password field by accident, because the button was disabled
     during the request.
   - It now returns to the restore button, and the message is scrolled into view.

## Screenshots (synthetic names only)

| | de | en |
|---|---|---|
| Restore, light, 1280 px, 100 % | [png](previous-restore-light-1280px-100pct-de.png) | [png](previous-restore-light-1280px-100pct-en.png) |
| Restore, dark, 1280 px, 100 % | [png](previous-restore-dark-1280px-100pct-de.png) | [png](previous-restore-dark-1280px-100pct-en.png) |
| Discard, light, 1280 px, 100 % | [png](previous-discard-light-1280px-100pct-de.png) | [png](previous-discard-light-1280px-100pct-en.png) |
| Discard, dark, 1280 px, 100 % | [png](previous-discard-dark-1280px-100pct-de.png) | [png](previous-discard-dark-1280px-100pct-en.png) |
| Restore, 520 px window, 200 % zoom | [png](previous-restore-light-520px-200pct-de.png) | [png](previous-restore-light-520px-200pct-en.png) |
| Discard, 520 px window, 200 % zoom | [png](previous-discard-light-520px-200pct-de.png) | [png](previous-discard-light-520px-200pct-en.png) |
| Keyboard focus on Cancel (restore) | [png](previous-restore-focus-cancel-de.png) | [png](previous-restore-focus-cancel-en.png) |
| Keyboard focus on confirm (discard) | [png](previous-discard-focus-confirm-de.png) | [png](previous-discard-focus-confirm-en.png) |
| Wrong master password | [png](previous-wrong-password-de.png) | [png](previous-wrong-password-en.png) |

The 520 px discard screenshots show the confirm button underlined: the mouse pointer rests
on it (hover style).

## Service guarantees (unchanged by PR #38)

- `restorePrevious` and `discardPrevious` (`src/lib/service.js`) call
  `authorizeSensitive(masterPassword)` and require `confirmed: true` in the same request
  that writes.
  - Both run inside `exclusive`, followed by `recheck` before the write.
  - Nothing is authorized in advance, and there is no pending state or token.
- Restore goes through `replaceContents`, the same atomic write path as a replacement:
  - kept copy first, then `commitAccounts`;
  - read-back verify, rollback, and an honest `unknown` outcome.
- Covered by `test/replace.test.mjs`:
  - wrong password and expired session;
  - a concurrent change during the restore;
  - termination at every write boundary.

## Concurrency

- **A change during the operation:** refused by the service. This is the unit test with a
  storage hook.
- **A change made after the dialog opened but before the confirm click (C-1):** not a
  conflict.
  - The swap keeps the changed state as the previous state, so nothing is lost.
  - The dialog text shows the count from when it opened.

## Not run or not passed

- Screen-reader speech (NVDA/JAWS): **MANUAL**. Roles, labels and names are checked in the
  DOM; the spoken output is not. This belongs to the 0.9.5 operator acceptance.
- Custom colours: `--err` is only guaranteed 3:1 against a custom background (existing rule
  for status and error colours, `src/lib/appearance.js`). The 4.5:1 above applies to the
  built-in light and dark themes.
- Suite: B3-real-4 and C4-8 are MANUAL. T-2 (focus ring of the tab bar) is NOT_TESTED because
  the window was not active. All three are unrelated to #25.
