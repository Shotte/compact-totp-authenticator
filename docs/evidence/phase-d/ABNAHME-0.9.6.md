# Abnahme mit 0.9.6 – kurze Checkliste für Ralf

0.9.6 ändert gegenüber der abgenommenen 0.9.5 nur die Oberfläche aus PR #41:
- **UX-1:** grüne Bestätigung nach „Sicherung prüfen“.
- **UX-2:** Der Knopf „Vorherigen Tresorstand löschen“ ist neutral. Der Dialogknopf
  „Endgültig löschen“ bleibt rot.
- **UX-3:** orangefarbener Hinweis, wenn der vorherige Tresorstand 30 Tage oder älter ist.

Falls PR #43 (nur Desktop) vor dem Signieren gemergt ist, fehlt außerdem der Android-Eintrag im
Manifest. Unter Windows ändert sich dadurch nichts.

Krypto, Speicherformat, Ersetzen und Wiederherstellen sind unverändert. Deshalb gibt es hier
**keinen** vollständigen Ersetzen-Test. Die Abnahme von #25 mit 0.9.5 gilt weiter.

Signierte Datei: `dist\signing\0.9.6\signed\…-0.9.6.xpi`. SHA-256, Quelle und `verify:signed`
trage ich nach dem Signieren ein. Signiert wird erst nach deiner Freigabe.

**Automatisch vor dieser Abnahme** (trage ich nach dem Signieren ein):
- signiertes Update 0.9.5 → 0.9.6 über den echten Update-Weg, mit Standard- und eigenem Kürzel;
- Browser-Suite auf `main` mit dem UX-Block: Bestätigung, Knopfarten, 30-Tage-Grenze bei
  29 Tagen, 29 Tagen 23:59, 30 und 45 Tagen, Kontrast hell und dunkel.

**Zwei Profile, nur Testdaten, wie bei 0.9.5:**

- **`CTA-Test`** (deine vorhandenen Testeinträge): nur das Upgrade und Ansehen (Teil 0). Dort
  nichts prüfen, ersetzen, wiederherstellen oder löschen.
- **`CTA-Wegwerf`** (neu, nur synthetische Daten): Teile 1–3. Das Profil wird am Ende gelöscht.
- Trage nie echte Konten ein. Dein normales Profil bleibt unberührt.

Trage pro Punkt **OK**, **Fehler: …** oder **nicht möglich** ein. Dauer gesamt etwa 15 Minuten.

## 0. Upgrade auf 0.9.6 im Profil CTA-Test (ohne Deinstallieren)

1. `& "C:\Program Files\Mozilla Firefox\firefox.exe" -P CTA-Test -no-remote`
2. Vorher kurz notieren: Anzahl der Einträge, Design, Schriftgröße, dein Tastenkürzel.
3. `about:addons` → Zahnrad → „Add-on aus Datei installieren…“ → die 0.9.6-Datei aus
   `C:\Workspace\compact-totp-authenticator\dist\signing\0.9.6\signed\` → „Hinzufügen“ bzw.
   „Aktualisieren“. **Nicht** vorher entfernen.

| Nr. | Prüfung | Erwartet | Ergebnis |
|---|---|---|---|
| 0.1 | `about:addons` → Compact TOTP Authenticator | Version **0.9.6**, keine Signaturwarnung, nur einmal installiert | |
| 0.2 | Popup mit Strg+Umschalt+2 bzw. deinem eigenen Kürzel öffnen, entsperren | Alle Einträge in gleicher Reihenfolge; Design, Schriftgröße und Kürzel wie notiert | |

## 1. Vorbereitung im Profil CTA-Wegwerf (etwa 5 Minuten)

1. Firefox ganz schließen, dann:
   `& "C:\Program Files\Mozilla Firefox\firefox.exe" -CreateProfile CTA-Wegwerf`
   `& "C:\Program Files\Mozilla Firefox\firefox.exe" -P CTA-Wegwerf -no-remote`
2. `about:addons` → „Add-on aus Datei installieren…“ → **0.9.6**.
3. Einstellungen öffnen, Test-Master-Passwort festlegen (z. B. `Wegwerf-Master-2026!`).
   **Allgemein → Import**: `C:\Workspace\compact-totp-authenticator\test\fixtures\acceptance-30-synthetic.json`
   importieren (30 synthetische Einträge).
4. **Allgemein → Export und Sicherung** → „Verschlüsselte CTA-Sicherung“, Export-Passwort z. B.
   `Exportpasswort-2026!`, Master-Passwort → Exportieren, Datei speichern.
5. Das Fenster **nicht maximiert** und etwa **halb so hoch** wie den Bildschirm stellen.

## 2. Die drei Änderungen

| Nr. | Prüfung | Erwartet | Ergebnis |
|---|---|---|---|
| 2.1 | **Allgemein → Wiederherstellen**: Datei, Export-Passwort und Master-Passwort → „Sicherung prüfen“ | **Grün** und ohne Scrollen sichtbar, direkt über der Vorschau: „Sicherung erfolgreich geprüft. Dein Tresor wurde noch nicht verändert.“ Das ist die einzige Meldung, der Fokus steht auf der Vorschau | |
| 2.2 | Danach ein Zeichen in ein Feld des Formulars tippen | Die grüne Meldung verschwindet mit der Vorschau | |
| 2.3 | Erneut prüfen (2.1), dann „Tresor jetzt ersetzen“ → „Ersetzen“ | Nur damit es einen vorherigen Stand gibt; die Meldung wie bei 0.9.5 | |
| 2.4 | Box „Vorheriger Tresorstand“ ansehen | „Vorherigen Tresorstand löschen“ sieht aus wie „Vorherigen Tresor wiederherstellen“: **neutral, nicht rot**. Noch **kein** orangefarbener Hinweis (der Stand ist neu) | |
| 2.5 | Master-Passwort → „Vorherigen Tresorstand löschen“ | Dialog „Vorherigen Tresorstand endgültig löschen?“; „Endgültig löschen“ ist **rot gefüllt**; Fokus auf **Abbrechen** | |
| 2.6 | **Abbrechen** | Dialog zu, nichts gelöscht, die Box bleibt | |

## 3. Hinweis nach 30 Tagen (synthetisch, nur in CTA-Wegwerf)

Damit niemand 30 Tage warten muss, wird nur das Datum des vorherigen Stands zurückgesetzt. Das
Datum ist ein einfacher Eintrag neben der verschlüsselten Kopie. Die Kopie selbst wird dabei
weder gelesen noch geändert.

1. In CTA-Wegwerf `about:debugging#/runtime/this-firefox` öffnen → bei Compact TOTP Authenticator
   „Untersuchen“ → Reiter **Konsole**.
2. Diese Zeile einfügen und Enter drücken. Firefox verlangt beim ersten Einfügen eventuell, dass
   du `Einfügen erlauben` tippst:

   ```js
   browser.storage.local.get("vault_previous").then(({ vault_previous: p }) => browser.storage.local.set({ vault_previous: { ...p, replacedAt: Date.now() - 31 * 864e5 } }))
   ```
3. Den Tab mit den Einstellungen neu laden (F5), entsperren, **Allgemein**.

| Nr. | Prüfung | Erwartet | Ergebnis |
|---|---|---|---|
| 3.1 | Box „Vorheriger Tresorstand“, **Darstellung → Design: Hell** | Unter dem Text in **Orange**: „Hinweis: Dein vorheriger Tresorstand ist älter als 30 Tage. Du kannst ihn weiterhin wiederherstellen oder löschen, wenn du ihn nicht mehr benötigst.“ Gut lesbar; das Datum im Text liegt etwa 31 Tage zurück | |
| 3.2 | **Design: Dunkel**, Box erneut ansehen | Der Hinweis ist ein helleres Orange und gut lesbar | |
| 3.3 | Nichts weiter tun, nur prüfen | Der vorherige Stand wird **nicht** automatisch gelöscht; beide Knöpfe sind da | |
| 3.4 | Optional: in der Konsole `31` durch `29` ersetzen, ausführen, neu laden | Kein Hinweis | |

## 4. Lesbarkeit

| Nr. | Prüfung | Erwartet | Ergebnis |
|---|---|---|---|
| 4.1 | Mit dem Hinweis aus 3.1: **Strg+Plus bis 200 %**, hell und dunkel | Hinweis, grüne Meldung (2.1 wiederholen) und beide Knöpfe lesbar, nichts abgeschnitten, **kein waagerechter Scrollbalken**; danach Strg+0 | |
| 4.2 | Fenster so schmal wie möglich ziehen | Text bricht um, kein waagerechter Scrollbalken | |

## Aufräumen

1. Die Export-Datei aus Schritt 1.4 löschen.
2. Firefox schließen. `about:profiles` in deinem normalen Firefox → Profil **CTA-Wegwerf** →
   „Entfernen“ → „Dateien löschen“.

Rückmeldung bitte als Liste: „0.1 OK, 2.4 Fehler: …“.
