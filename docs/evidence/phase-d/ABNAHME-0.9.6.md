# Abnahme mit 0.9.6 – kurze Checkliste für Ralf

0.9.6 ändert gegenüber der abgenommenen 0.9.5 nur die Oberfläche aus PR #41:
- **UX-1:** grüne Bestätigung nach „Sicherung prüfen“.
- **UX-2:** Der Knopf „Vorherigen Tresorstand löschen“ ist neutral. Der Dialogknopf
  „Endgültig löschen“ bleibt rot.
- **UX-3:** orangefarbener Hinweis, wenn der vorherige Tresorstand 30 Tage oder älter ist.

Dazu fehlt der Android-Eintrag im Manifest (PR #43, nur Desktop). Unter Windows ändert sich
dadurch nichts.

Krypto, Speicherformat, Ersetzen und Wiederherstellen sind unverändert. Deshalb gibt es hier
**keinen** vollständigen Ersetzen-Test. Die Abnahme von #25 mit 0.9.5 gilt weiter.

Signierte Datei: `dist\signing\0.9.6\signed\b6d63835a4834f55a37a-0.9.6.xpi`
(SHA-256 `c7000043e886da55e43f347f0a4af3bd724ae8908fb80cba1d223b6d6e8cd48f`, Quelle `d297a47`,
`verify:signed` 6/6 OK).

**Automatisch bereits bestanden** (Details in [signed-update-0.9.6/README.md](signed-update-0.9.6/README.md)):
- Signiertes Update 0.9.5 → 0.9.6 über den echten Firefox-Update-Weg, mit Signaturprüfung:
  - ID und UUID bleiben gleich, ebenso Einträge, Reihenfolge, Verschlüsselung und Einstellungen.
  - Die Codes stimmen, nach dem Neustart ist der Tresor gesperrt.
  - Ergebnis: 11 PASS und 1 NOT_TESTED (U-S3, ohne geändertes Kürzel nicht prüfbar) bzw. 12/12
    mit eigenem Kürzel. Ctrl+Shift+9 bleibt erhalten, Ctrl+Shift+2 öffnet dann nichts.
- Browser-Suite mit dem signierten Inhalt, Deutsch und Englisch: je 110 PASS, 0 FAIL.
  - Der UX-Block prüft die grüne Bestätigung, die Knopfarten und die 30-Tage-Grenze (bei
    29 Tagen und 29 Tagen 23:59 kein Hinweis, bei 30 und 45 Tagen sichtbar).
  - Kontrast des Hinweises: hell 5,58:1, dunkel 7,15:1.

**Status: von Ralf auf Windows abgenommen (2026-11-24), Firefox 160.0.1, signierte 0.9.6
(SHA-256 oben).** Alle von Hand ausgeführten Punkte: PASS. Ergebnisse in der Spalte „Ergebnis“,
die Nummern des Betreiberberichts in Klammern. Einordnung der Belege:

- **Automatisch:** signiertes Update und Browser-Suite (oben), mit Lauf-Dateien im Repository.
- **Von Hand bestätigt:** vom Betreiber gemeldetes PASS je Punkt.
- **Bildschirmfotos:** vom Betreiber aufgenommen und im Chat gesichtet (grüne Meldung, Vorschau
  30/30, Zustand nach der Änderung, Knöpfe und Dialog, Hinweis hell und dunkel, 200 %). Sie sind
  **nicht** im Repository; sie zeigen nur synthetische Einträge.
- **Nicht geprüft:** Bildschirmleser-Ausgabe, echte Tasten unter macOS und Linux, Firefox ESR 140
  von Hand. Teil 3.4 von Hand (optional), Teil 2.3 nicht einzeln gemeldet, Aufräumen nicht
  gemeldet.
- **Ablauf, kein Produktfehler:** Der erste Konsolenbefehl in Teil 3 brachte Syntaxfehler, weil
  Markdown-Zeichen mitkopiert wurden. Nach der Korrektur wurde nur `replacedAt` geändert.
- Zusätzlich gesehen: Der neutrale Hinweis unter „Master-Passwort ändern“ erklärt, dass ein
  Wechsel die vorherige verschlüsselte Kopie entfernt. Das Master-Passwort wurde **nicht**
  geändert.
- Das Profil CTA-Wegwerf aus 0.9.5 wurde wiederverwendet (0.9.6 installiert, synthetische
  Einträge vorhanden).

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
| 0.1 | `about:addons` → Compact TOTP Authenticator | Version **0.9.6**, keine Signaturwarnung, nur einmal installiert | **PASS** (Betreiber 0.1) |
| 0.2 | Popup mit Strg+Umschalt+2 bzw. deinem eigenen Kürzel öffnen, entsperren | Alle Einträge in gleicher Reihenfolge; Design, Schriftgröße und Kürzel wie notiert | **PASS** (Betreiber 0.2–0.5: Einträge, Reihenfolge, Darstellung und Einstellungen erhalten, Strg+Umschalt+2 öffnet das Popup) |

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
| 2.1 | **Allgemein → Wiederherstellen**: Datei, Export-Passwort und Master-Passwort → „Sicherung prüfen“ | **Grün** und ohne Scrollen sichtbar, direkt über der Vorschau: „Sicherung erfolgreich geprüft. Dein Tresor wurde noch nicht verändert.“ Das ist die einzige Meldung, der Fokus steht auf der Vorschau | **PASS** (Betreiber 3.1–3.4: grün, ohne Scrollen, Vorschau 30/30, keine zweite Meldung; Bildschirmfoto gesichtet) |
| 2.2 | Danach ein Zeichen in ein Feld des Formulars tippen | Die grüne Meldung verschwindet mit der Vorschau | **PASS** (Betreiber 3.5; Bildschirmfoto gesichtet) |
| 2.3 | Erneut prüfen (2.1), dann „Tresor jetzt ersetzen“ → „Ersetzen“ | Nur damit es einen vorherigen Stand gibt; die Meldung wie bei 0.9.5 | nicht einzeln gemeldet: Das wiederverwendete Profil hatte schon einen vorherigen Stand |
| 2.4 | Box „Vorheriger Tresorstand“ ansehen | „Vorherigen Tresorstand löschen“ sieht aus wie „Vorherigen Tresor wiederherstellen“: **neutral, nicht rot**. Noch **kein** orangefarbener Hinweis (der Stand ist neu) | **PASS** für „neutral“ (Betreiber 4.1; Bildschirmfoto gesichtet). „Noch kein Hinweis“ nicht einzeln gemeldet, automatisch PASS |
| 2.5 | Master-Passwort → „Vorherigen Tresorstand löschen“ | Dialog „Vorherigen Tresorstand endgültig löschen?“; „Endgültig löschen“ ist **rot gefüllt**; Fokus auf **Abbrechen** | **PASS** (Betreiber 4.2–4.4: rot im Dialog, Text nennt nur die verschlüsselte Kopie, Fokus auf Abbrechen; Bildschirmfoto gesichtet) |
| 2.6 | **Abbrechen** | Dialog zu, nichts gelöscht, die Box bleibt | **PASS** (Betreiber 4.5: Escape bzw. Abbrechen, nichts gelöscht) |

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
| 3.1 | Box „Vorheriger Tresorstand“, **Darstellung → Design: Hell** | Unter dem Text in **Orange**: „Hinweis: Dein vorheriger Tresorstand ist älter als 30 Tage. Du kannst ihn weiterhin wiederherstellen oder löschen, wenn du ihn nicht mehr benötigst.“ Gut lesbar; das Datum im Text liegt etwa 31 Tage zurück | **PASS** (Betreiber 5.1–5.3, 5.6: orange, verständlich, kein Fehlerton; Datum 24.10.2026; Bildschirmfoto gesichtet) |
| 3.2 | **Design: Dunkel**, Box erneut ansehen | Der Hinweis ist ein helleres Orange und gut lesbar | **PASS** (Betreiber 5.7; Bildschirmfoto gesichtet) |
| 3.3 | Nichts weiter tun, nur prüfen | Der vorherige Stand wird **nicht** automatisch gelöscht; beide Knöpfe sind da | **PASS** (Betreiber 5.4–5.5: Knöpfe neutral, nichts automatisch gelöscht) |
| 3.4 | Optional: in der Konsole `31` durch `29` ersetzen, ausführen, neu laden | Kein Hinweis | NOT_TESTED von Hand (optional); automatisch PASS bei 29 Tagen und 29 Tagen 23:59 |

## 4. Lesbarkeit

| Nr. | Prüfung | Erwartet | Ergebnis |
|---|---|---|---|
| 4.1 | Mit dem Hinweis aus 3.1: **Strg+Plus bis 200 %**, hell und dunkel | Hinweis, grüne Meldung (2.1 wiederholen) und beide Knöpfe lesbar, nichts abgeschnitten, **kein waagerechter Scrollbalken**; danach Strg+0 | **PASS** (echter Firefox-Zoom 200 %, hell und dunkel; Bildschirmfotos bei 200 % laut Betreiber) |
| 4.2 | Fenster so schmal wie möglich ziehen | Text bricht um, kein waagerechter Scrollbalken | **PASS** (schmales Fenster bei 200 %; kein waagerechter Überlauf. Überschriften brechen im extrem schmalen Layout innerhalb von Wörtern um: akzeptiert, kein Blocker) |

## Aufräumen

1. Die Export-Datei aus Schritt 1.4 löschen.
2. Firefox schließen. `about:profiles` in deinem normalen Firefox → Profil **CTA-Wegwerf** →
   „Entfernen“ → „Dateien löschen“.

Rückmeldung bitte als Liste: „0.1 OK, 2.4 Fehler: …“.
