# Abnahme mit 0.9.5 – Checkliste für Ralf

Mit 0.9.5 kommen zwei Vereinfachungen für #25 dazu:
- **Tresor ersetzen (PR #37):** einmal prüfen, eine Vorschau, ein Bestätigungsdialog.
- **Vorheriger Tresorstand (PR #38):** das Master-Passwort einmal eingeben, dann ein Dialog je
  Aktion, ohne Häkchen.

Die Punkte unten prüfen gezielt die Probleme aus der Abnahme von 0.9.4:
- Meldungen unterhalb des sichtbaren Bereichs;
- eine verlorene Dateiauswahl;
- doppelte Passwortabfragen;
- überflüssiges Häkchen;
- mehrere Meldungen gleichzeitig.

Signierte Datei: `dist\signing\0.9.5\signed\b6d63835a4834f55a37a-0.9.5.xpi`
(SHA-256 `794d89fd2dc6e63cd6285e0af0e7c32fbb5c0d63ff8aac3a5776d00b95227946`, Quelle `9637b12`,
`verify:signed` 6/6 OK).

**Automatisch bereits bestanden** (Details in [signed-update-0.9.5/README.md](signed-update-0.9.5/README.md)):

- Signiertes Update 0.9.4 → 0.9.5 über den echten Firefox-Update-Weg, mit Signaturprüfung:
  - ID und UUID bleiben gleich, ebenso Einträge, Reihenfolge, Verschlüsselung und Einstellungen.
  - Das Master-Passwort funktioniert, nach dem Neustart ist der Tresor gesperrt.
  - Ergebnis: 11 PASS und 1 NOT_TESTED (U-S3, ohne geändertes Kürzel nicht prüfbar) bzw. 12/12
    mit eigenem Kürzel. Ctrl+Shift+9 bleibt erhalten, Ctrl+Shift+2 öffnet dann nichts.
- Ersetzen (V2) samt Wiederherstellen und Löschen des vorherigen Stands auf der aktualisierten
  signierten Installation: PASS.
- Die Dialoge zum vorherigen Tresorstand mit dem signierten Inhalt, in Deutsch und Englisch:
  8/8 PASS. Geprüft wurden Zoom 100–200 %, hell und dunkel, schmales Fenster, Tastatur, falsches
  Passwort und Doppelklick.

**Offen, nur durch dich prüfbar:**
- das Upgrade deines Profils `CTA-Test`;
- der ganze Ablauf von Hand, mit dem Augenmerk auf die Probleme aus 0.9.4;
- optional die Ausgabe eines Screenreaders.

Genau das prüfen die Punkte unten.

**Zwei Profile, nur Testdaten:**

- **`CTA-Test`** (deine vorhandenen Testeinträge): nur das Upgrade und Prüfungen, die nichts
  ersetzen, wiederherstellen oder löschen (Teil 0). Die Box „Vorheriger Tresorstand“ dort
  **nicht** benutzen.
- **`CTA-Wegwerf`** (neu, nur synthetische Daten): alles andere (Teile 1–4). Das Profil wird am
  Ende gelöscht.
- Trage nie echte Konten ein. Dein normales Profil bleibt unberührt.

Trage pro Punkt **OK**, **Fehler: …** oder **nicht möglich** ein. Ein Punkt ist OK, wenn alles in
der Spalte „Erwartet“ zutrifft. Dauer gesamt etwa 30 Minuten.

## 0. Upgrade auf 0.9.5 im Profil CTA-Test (ohne Deinstallieren)

1. `& "C:\Program Files\Mozilla Firefox\firefox.exe" -P CTA-Test -no-remote`
2. `about:addons` → Zahnrad → „Add-on aus Datei installieren…“ → die Datei aus
   `C:\Workspace\compact-totp-authenticator\dist\signing\0.9.5\signed\` → „Hinzufügen“ bzw.
   „Aktualisieren“. **Nicht** vorher entfernen.

| Nr. | Prüfung | Erwartet | Ergebnis |
|---|---|---|---|
| 0.1 | `about:addons` → Compact TOTP Authenticator | Version **0.9.5**, keine Signaturwarnung | |
| 0.2 | Popup öffnen (Strg+Umschalt+2 oder dein eigenes Kürzel), entsperren | Alle bisherigen Testeinträge, gleiche Reihenfolge; Einstellungen wie vorher | |

## 1. Vorbereitung im Profil CTA-Wegwerf (etwa 5 Minuten)

1. Firefox ganz schließen, dann:
   `& "C:\Program Files\Mozilla Firefox\firefox.exe" -CreateProfile CTA-Wegwerf`
   `& "C:\Program Files\Mozilla Firefox\firefox.exe" -P CTA-Wegwerf -no-remote`
2. `about:addons` → „Add-on aus Datei installieren…“ → **0.9.5** aus `dist\signing\0.9.5\signed\`.
3. Einstellungen öffnen, Test-Master-Passwort festlegen (z. B. `Wegwerf-Master-2026!`).
   **Allgemein → Import**: `C:\Workspace\compact-totp-authenticator\test\fixtures\acceptance-30-synthetic.json`
   importieren (30 synthetische Einträge).
4. **Allgemein → Export und Sicherung** → „Verschlüsselte CTA-Sicherung“, Export-Passwort z. B.
   `Exportpasswort-2026!`, Master-Passwort → Exportieren, Datei speichern.
5. In **2FA-Einträge** einen Eintrag „Neu nach Export“ hinzufügen (Schlüssel
   `JBSWY3DPEHPK3PXP`) und „Test Bravo“ löschen. Jetzt: 30 Einträge, davon einer nicht in der
   Sicherung.
6. Das Firefox-Fenster **nicht maximiert** und nur etwa **halb so hoch** wie den Bildschirm
   stellen. Dann zu **Allgemein → Wiederherstellen** scrollen, bis „Sicherung prüfen“ ganz
   unten am Fensterrand steht. So zeigt sich, ob Meldungen unten verschwinden.

## 2. Tresor durch eine Sicherung ersetzen (PR #37)

| Nr. | Prüfung | Erwartet | Ergebnis |
|---|---|---|---|
| 2.1 | Abschnitt ansehen | Überschrift „Wiederherstellen: Tresor durch eine verschlüsselte Sicherung ersetzen“; **ein** Formular mit Sicherungsdatei, Export-Passwort, Aktuelles Master-Passwort; Knopf „Sicherung prüfen“, darunter „Prüfen ändert noch nichts.“; **kein** Häkchen | |
| 2.2 | Datei wählen, **falsches** Export-Passwort, richtiges Master-Passwort → „Sicherung prüfen“ | „Die Sicherung ließ sich nicht entschlüsseln …“ ist **ohne Scrollen sichtbar**, direkt unter dem Formular, und die einzige Meldung auf der Seite. Nur das Export-Passwort ist geleert und hat den Cursor; Master-Passwort und **Dateiauswahl bleiben** | |
| 2.3 | Export-Passwort richtig, **falsches** Master-Passwort → „Sicherung prüfen“ | „Das Master-Passwort dieses Tresors ist falsch. Es wurde nichts wiederhergestellt.“, sichtbar und einzige Meldung; nur das Master-Passwort ist geleert und hat den Cursor; Datei bleibt ausgewählt | |
| 2.4 | Beide Passwörter richtig → „Sicherung prüfen“ | Die Seite zeigt von selbst die **Vorschau**, der Fokus steht auf deren Überschrift. Keine weitere Meldung. Beide Passwortfelder sind leer; jedes Passwort wurde **genau einmal** eingegeben | |
| 2.5 | Vorschau lesen | „Aktuell 30 Einträge · Sicherung 30 Einträge · in beiden 29.“; „Neu nach Export“ steht unter „Diese 1 Einträge gibt es nur in deinem aktuellen Tresor …“; „Test Bravo“ unter „Nur in der Sicherung (1):“; Hinweis, dass der jetzige Stand als Kopie bleibt | |
| 2.6 | „Tresor jetzt ersetzen“ klicken | Dialog „Tresor jetzt ersetzen?“ mit beiden Anzahlen; der Fokus steht auf **Abbrechen**; **kein** Passwortfeld, **kein** Häkchen | |
| 2.7 | Im Dialog **Esc** drücken | Dialog zu, nichts geändert, Fokus wieder auf „Tresor jetzt ersetzen“ | |
| 2.8 | Erneut „Tresor jetzt ersetzen“ → **Tab** → „Ersetzen“ (rot) mit Enter | Genau **eine** Meldung, sichtbar: „Tresor ersetzt: Er enthält jetzt die 30 2FA-Einträge der Sicherung. Dein bisheriger Stand mit 30 Einträgen …“; die Vorschau ist zu | |
| 2.9 | **2FA-Einträge** und Popup | „Test Bravo“ wieder da, „Neu nach Export“ weg; Master-Passwort unverändert | |
| 2.10 | Ablauf: Datei und beide Passwörter → „Sicherung prüfen“, dann **mehr als 3 Minuten** warten, ohne zu klicken | Die Vorschau schließt sich von selbst; sichtbar steht „Die Prüfung gilt nicht mehr (nach 3 Minuten …). Es wurde nichts geändert …“; Datei bleibt ausgewählt. **Nichts** wurde ersetzt | |
| 2.11 | Sperre: prüfen, dann im Popup **Sperren**, Seite neu entsperren | Die Vorschau ist weg; Ersetzen ist erst nach erneutem Prüfen möglich | |

## 3. Vorheriger Tresorstand (PR #38)

Nach 2.8 gibt es den vorherigen Stand mit „Neu nach Export“. Das Fenster bleibt halb hoch.

| Nr. | Prüfung | Erwartet | Ergebnis |
|---|---|---|---|
| 3.1 | Box „Vorheriger Tresorstand“ ansehen | Text mit Datum und Anzahl; **ein** Feld „Aktuelles Master-Passwort“; Knöpfe „Vorherigen Tresor wiederherstellen“ und **rot** „Vorherigen Tresorstand löschen“; **kein** Häkchen | |
| 3.2 | **Falsches** Master-Passwort → „Vorherigen Tresor wiederherstellen“ → im Dialog „Tauschen“ | Genau **eine** Meldung, ohne Scrollen sichtbar, direkt unter den Knöpfen: „Das Master-Passwort dieses Tresors ist falsch …“; Feld leer mit Cursor; Einträge und Box unverändert | |
| 3.3 | Richtiges Master-Passwort → „Vorherigen Tresor wiederherstellen“ | Dialog „Vorherigen Tresorstand zurückholen?“ nennt **beide** Anzahlen und das Datum und sagt, dass nichts verloren geht; Fokus auf **Abbrechen** | |
| 3.4 | **Esc** | Dialog zu, nichts geändert, Fokus wieder auf „Vorherigen Tresor wiederherstellen“ | |
| 3.5 | Erneut öffnen → **Tab** → „Tauschen“ mit Enter | Genau **eine** Meldung in der Box, sichtbar: „Vorheriger Tresor wiederhergestellt: 30 2FA-Einträge …“; „Neu nach Export“ ist zurück; die Box zeigt jetzt den getauschten Stand; Passwort nur **einmal** eingegeben | |
| 3.6 | Master-Passwort → „Vorherigen Tresorstand löschen“ | Dialog „Vorherigen Tresorstand endgültig löschen?“ mit „lässt sich nicht rückgängig machen“; „Endgültig löschen“ ist **rot gefüllt**; Fokus auf **Abbrechen** | |
| 3.7 | „Endgültig löschen“ | „Der vorherige Tresorstand wurde gelöscht.“, sichtbar; die Box verschwindet; deine aktuellen Einträge sind unverändert | |

## 4. Optik und Bedienung (kurz)

| Nr. | Prüfung | Erwartet | Ergebnis |
|---|---|---|---|
| 4.1 | Für 3.6 noch einmal einen vorherigen Stand erzeugen (2.4–2.8 wiederholen), dann die Dialoge aus 2.6 und 3.3/3.6 bei **Strg+Plus 200 %** öffnen | Alles lesbar, nichts abgeschnitten, kein waagerechter Scrollbalken; danach Strg+0 | |
| 4.2 | **Darstellung → Design: Dunkel**, Dialoge erneut ansehen | Gut lesbar; der rote Knopf hebt sich klar von „Abbrechen“ ab | |
| 4.3 | Optional mit NVDA (falls installiert): Dialog aus 3.3 öffnen | NVDA liest Titel und Text des Dialogs und „Abbrechen, Schalter“ vor | |

## Aufräumen

1. Die Export-Datei aus Schritt 4 löschen.
2. Firefox schließen. `about:profiles` in deinem normalen Firefox → Profil **CTA-Wegwerf** →
   „Entfernen“ → „Dateien löschen“.

Rückmeldung bitte als Liste: „0.1 OK, 2.3 Fehler: …“.
