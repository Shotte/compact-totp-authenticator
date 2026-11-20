# Abnahme-Checkliste für Ralf

Nur die Prüfungen, die keine Automatisierung ersetzen kann. Was CI und lokale Browsertests
schon belegen, steht unten unter „Bereits automatisch belegt“ und muss nicht wiederholt
werden.

**Testdaten und echte Daten trennen:**
- Arbeite nur im separaten Firefox-Profil `CTA-Test`, mit den Testdateien aus
  `test/fixtures/` und einem ausgedachten Master-Passwort.
- Trage nie echte TOTP-Konten ein.
- Dein normales Profil und dein bisheriger Authenticator bleiben unberührt.

Trage pro Punkt **OK**, **Fehler: …** oder **nicht möglich** ein.

| Gruppe | Firefox | Signierter Build | Dauer |
|---|---|---|---|
| 1 Popup-Darstellung, Designs, Größen (#2) | Release 160, Windows | 0.9.0 (oder `npm start`) | 10 Min. |
| 2 Maus, Kopieren, Tastatur, Kürzel (#3, #6) | Release 160, Windows | 0.9.0 (oder `npm start`) | 5 Min. |
| 3 Datei-Dialoge Import/Export (#5) | – | – | 0 Min. (Windows automatisch belegt) |
| 4 Neustart und Sperre (#4) | Release 160, Windows | **0.9.0** | 3 Min. |
| 5 Signiertes Update (#19) | Release 160, Windows | **0.9.0 und 0.9.1** | 10 Min. |

## Vorbereitung: Testprofil und signiertes 0.9.0 (5 Min.)

1. Testprofil anlegen und starten. Dein normales Firefox darf dabei offen bleiben:

   ```powershell
   & "C:\Program Files\Mozilla Firefox\firefox.exe" -CreateProfile CTA-Test
   & "C:\Program Files\Mozilla Firefox\firefox.exe" -P CTA-Test -no-remote
   ```

2. Im Testprofil: `about:addons` → Zahnrad → „Add-on aus Datei installieren…“ → die
   signierte XPI aus `dist\signing\0.9.0\signed\` wählen → „Hinzufügen“. Es darf keine
   Warnung über eine fehlende Signatur erscheinen.
3. Den Hinweis „… wurde hinzugefügt“ einfach schließen. Anheften ist nicht nötig, das
   Symbol sitzt bereits in der Symbolleiste (Prüfung 2.1).
4. CTA-Symbol → Zahnrad (Einstellungen) → Master-Passwort festlegen, z. B.
   `Testpasswort-2026!`.
5. Einstellungen → Import → „Durchsuchen…“ → `test\fixtures\visual-30-synthetic.json` →
   Master-Passwort eingeben → „Importieren“. Ergebnis: 30 Konten mit kurzen und langen
   Namen und Umlauten, von „Mail“ bis „Zahlungsdienst“.

Ohne signierten Build geht Gruppe 1–2 auch mit `npm start`: Firefox startet dann mit einem
eigenen Wegwerf-Profil und CTA als temporärem Add-on. Weiter ab Schritt 4.

## 1. Popup-Darstellung, Designs, Größen (#2)

| Nr. | Schritte | Erwartet | Ergebnis |
|---|---|---|---|
| 1.1 | CTA-Symbol in der Symbolleiste anklicken | Echtes Popup, schmal (270 px), eine kompakte 25-px-Zeile pro Konto, Name links, Code rechts | |
| 1.2 | Lange Namen ansehen, z. B. „Server-Administration Rechenzentrum Ost“ | Name wird sauber gekürzt („…“), der Code bleibt vollständig sichtbar; Umlaute korrekt | |
| 1.3 | Mit Mausrad ganz nach unten scrollen | „Zahlungsdienst“ ist vollständig sichtbar; die Fußleiste (Sperren, Einstellungen) bleibt fest unten | |
| 1.4 | Einstellungen → Darstellung: hell, dunkel, automatisch. Bei automatisch den Windows-Farbmodus umschalten und das Popup neu öffnen | Jedes Design ist gut lesbar; automatisch folgt Windows | |
| 1.5 | Eigene Farben wählen, darunter bewusst eine Kombination mit wenig Kontrast | Farben werden übernommen; bei zu wenig Kontrast passt CTA die Textfarbe an und zeigt einen Hinweis | |
| 1.6 | Schriftgröße 12 und 20 px, Zeilenhöhe klein und groß | Nichts ist abgeschnitten oder überlappt; die Liste bleibt scrollbar | |
| 1.7 | Die Einstellungsseite selbst ansehen, hell und dunkel | Aufgeräumt, lesbar, Beschriftungen auf Deutsch, nichts überlappt | |

## 2. Maus, Kopieren, Tastatur, Kürzel (#3, #6)

| Nr. | Schritte | Erwartet | Ergebnis |
|---|---|---|---|
| 2.1 | Direkt nach der Installation auf die Symbolleiste schauen | Das CTA-Symbol sitzt in der Symbolleiste, nicht im Überlaufmenü | |
| 2.2 | Langsam mit der Maus über die Zeilen fahren | Die Hervorhebung ist dezent, aber erkennbar; nichts verspringt | |
| 2.3 | Eine Zeile auf dem Namen, eine auf dem Code, eine auf der freien Fläche dazwischen anklicken; jeweils mit Strg+V in die Adressleiste einfügen | Jeder Klick kopiert den Code **dieser** Zeile; kurz erscheint ein grüner Haken | |
| 2.4 | Website-Hervorhebung: example.com öffnen, dann das Popup | Das Konto „Wolkenspeicher Plus“ ist markiert | |
| 2.5 | Popup schließen, **nur Tastatur**: Alt+Shift+A → Tab → Tab → Enter → Strg+V in ein Textfeld | Alt+Shift+A öffnet das Popup; Tab zeigt einen sichtbaren Rahmen; Enter kopiert den Code der gerahmten Zeile | |
| 2.6 | In deinem **normalen** Firefox nur nachsehen, ohne etwas zu installieren: `about:addons` → Zahnrad → „Erweiterungs-Tastenkombinationen verwalten“ | Keine deiner Erweiterungen nutzt Alt+Shift+A. Sonst bitte den Namen notieren | |

## 3. Datei-Dialoge Import/Export (#5)

Unter Windows ist **nichts** zu tun. Die echten Windows-Dialoge sind automatisch geprüft:
- Speichern, Abbrechen und ein Schreibfehler beim Export (N1–N3);
- Öffnen und Wiederherstellen (N4);
- Öffnen beim Altdaten-Import (N5).

Der Beleg ist `docs/evidence/phase-c6/native-dialogs-windows.json`. macOS und Linux sind
als Portabilitätsgrenze dokumentiert (RELEASE.md §5).

## 4. Neustart und Sperre (#4) – mit dem signierten 0.9.0

| Nr. | Schritte | Erwartet | Ergebnis |
|---|---|---|---|
| 4.1 | Popup öffnen, entsperren (Codes sichtbar). Firefox (Testprofil) komplett beenden und mit `-P CTA-Test -no-remote` neu starten | CTA ist noch installiert; das Popup fragt nach dem Master-Passwort und zeigt keine Codes; nach Eingabe sind alle 30 Konten da | |

## 5. Signiertes Update (#19) – nach der Signierung von 0.9.1

| Nr. | Schritte | Erwartet | Ergebnis |
|---|---|---|---|
| 5.1 | `node test/browser/update-test.mjs --old <0.9.0.xpi> --new <0.9.1.xpi>` (docs/SIGNING.md §7). Läuft allein in einem eigenen Wegwerf-Profil | U-1 bis U-7 und U-signed stehen auf PASS | |

## Aufräumen

1. Im Testprofil: `about:addons` → Compact TOTP Authenticator → „…“ → „Entfernen“. Das
   löscht auch die Testkonten des Add-ons.
2. Firefox (Testprofil) schließen, dann `& "C:\Program Files\Mozilla Firefox\firefox.exe" -P`
   → `CTA-Test` → „Profil löschen“ → „Dateien löschen“.
3. Testbuilds nie an andere weitergeben. Sie suchen Updates nur unter 127.0.0.1 und
   bekommen nie ein Update.

## Bereits automatisch belegt (nicht wiederholen)

| Thema | Beleg |
|---|---|
| Tab durch die Zeilen, Enter und Leertaste kopieren, Sperren und Einstellungen per Tab erreichbar | B8-4, B8-2 (alle CI-Plattformen) |
| Symbol standardmäßig in der Symbolleiste; Alt+Shift+A registriert, kein Konflikt mit Firefox | C6-1, C6-2 |
| Popup-Maße und Scrollen mit 1/25/50/100 Konten; echtes Popup-Fenster | B3-Layouts, B3-real-1…3 |
| Kopieren schreibt den richtigen Code genau einmal (im Popup als Tab; im echten Popup-Fenster nur per `--os-input`, daher 2.3) | B3-copy, B8-4 |
| Hover in hell, dunkel, automatisch mit Kontrast ≥ 4,5; Schriftgrößen 12–20 px und Zeilenhöhen | B8-1, B7 |
| Windows-Dialoge Speichern, Abbrechen, Fehler, Öffnen, Import | N1–N5 |
| Neustart sperrt, Sitzungsspeicher leer | C2-6, C3-1, U-7 |
| Beschädigter Tresor: ehrliche Meldung, keine Wiederherstellung, nichts geschrieben (#8) | C2-5b |

Rückmeldung bitte als Liste: „1.1 OK, 1.2 Fehler: …“.
