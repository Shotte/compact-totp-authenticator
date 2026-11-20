# Abnahme-Checkliste für Ralf

Nur die Prüfungen, die keine Automatisierung ersetzen kann. Was CI und lokale Browsertests
schon belegen, steht unten unter „Bereits automatisch belegt“ und muss nicht wiederholt
werden.

**Testdaten und echte Daten trennen:**
- Arbeite nur in einem Wegwerf-Firefox-Profil, mit den Testdateien aus `test/fixtures/`
  und einem ausgedachten Master-Passwort.
- Trage nie echte TOTP-Konten ein.
- Dein normales Firefox-Profil bleibt unberührt.

Trage pro Punkt **OK**, **Fehler: …** oder **nicht möglich** ein.

| Gruppe | Firefox | Signierter Build nötig | Dauer |
|---|---|---|---|
| 1 Popup-Darstellung und Scrollen (#2) | aktuelles Release (160), Windows | nein | 8 Min. |
| 2 Maus, Tastatur, Zwischenablage, Kürzel (#3, #6) | aktuelles Release (160), Windows | nein | 5 Min. |
| 3 Datei-Dialoge Import/Export (#5) | – | – | 0 Min. unter Windows |
| 4 Neustart und Sperre (#4) | aktuelles Release (160), Windows | **ja** (0.9.0) | 3 Min. |
| 5 Signierte Installation und Update (#19) | aktuelles Release (160), Windows | **ja** (0.9.0 und 0.9.1) | 10 Min. |

Gruppen 1–2 gehen sofort. Gruppen 4–5 gehen erst nach der freigegebenen Signierung
(docs/SIGNING.md §3–6).

## Vorbereitung für Gruppe 1–2 (3 Min.)

1. Im Repository `npm start` ausführen. Firefox startet mit einem **frischen
   Wegwerf-Profil** und CTA als temporärem Add-on. Beim Schließen wird das Profil
   verworfen.
2. CTA-Symbol → Einstellungen → Master-Passwort anlegen, z. B. `Testpasswort-2026`.
3. Einstellungen → Import → `test/fixtures/acceptance-30-synthetic.json` wählen →
   Master-Passwort eingeben → „Importieren“. Es entstehen 30 Konten „Test Alpha“ bis
   „Test West“.

## 1. Popup-Darstellung und Scrollen (#2)

| Nr. | Schritte | Erwartet | Ergebnis |
|---|---|---|---|
| 1.1 | Auf das CTA-Symbol klicken | Schmales Popup (270 px), eine kompakte Zeile pro Konto, Name links, Code rechts, Fußleiste unten | |
| 1.2 | Mit Mausrad oder Bildlaufleiste ganz nach unten scrollen | „Test West“ ist vollständig sichtbar; die Fußleiste bleibt stehen | |
| 1.3 | Einstellungen → Design hell, dann dunkel, dann automatisch; bei automatisch den Windows-Farbmodus umschalten und das Popup neu öffnen | Jedes Design ist gut lesbar; automatisch folgt Windows | |
| 1.4 | Eigene Farben mit wenig Kontrast wählen, dann Schriftgröße 12 und 20 px | Nichts ist abgeschnitten; bei zu wenig Kontrast passt CTA die Textfarbe an und zeigt einen Hinweis | |
| 1.5 | Maus über Zeilen bewegen; eine Website öffnen, deren Adresse bei einem Konto steht (Konto bearbeiten → Website `example.com`, dann example.com öffnen) | Die Hervorhebung ist dezent, aber erkennbar; das passende Konto ist markiert | |

## 2. Maus, Tastatur, Zwischenablage, Kürzel (#3, #6)

| Nr. | Schritte | Erwartet | Ergebnis |
|---|---|---|---|
| 2.1 | Nach dem Start ohne eigenes Zutun auf die Symbolleiste schauen | Das CTA-Symbol sitzt direkt in der Symbolleiste, nicht im Überlaufmenü | |
| 2.2 | Eine Zeile anklicken, dann in ein Textfeld (z. B. die Adressleiste) mit Strg+V einfügen | Grüner Haken in der Zeile; eingefügt wird genau der angezeigte Code | |
| 2.3 | Popup schließen, **nur Tastatur**: Alt+Shift+A → Tab → Tab → Enter → Strg+V in ein Textfeld | Alt+Shift+A öffnet das Popup; Tab zeigt einen sichtbaren Rahmen; Enter kopiert den Code der gerahmten Zeile | |
| 2.4 | In deinem **normalen** Firefox nur nachsehen, ohne etwas zu installieren: about:addons → Zahnrad → „Erweiterungs-Tastenkombinationen verwalten“ | Keine deiner Erweiterungen nutzt Alt+Shift+A. Sonst bitte den Namen notieren | |

## 3. Datei-Dialoge Import/Export (#5)

Unter Windows ist **nichts** zu tun. Die echten Windows-Dialoge sind automatisch geprüft:
- Speichern, Abbrechen und ein Schreibfehler beim Export (N1–N3);
- Öffnen und Wiederherstellen (N4);
- Öffnen beim Altdaten-Import (N5).

Der Beleg ist `docs/evidence/phase-c6/native-dialogs-windows.json`.

macOS und Linux: nur falls du ein solches Gerät hast. Dann Export speichern, Abbrechen,
Wiederherstellen und Import wählen wie oben. Sonst bleibt der Punkt MANUAL_REVIEW, und die
Architektur entscheidet, ob Windows für 1.0 reicht.

## 4. Neustart und Sperre (#4) – nach der Signierung

Die automatische Prüfung U-7 im signierten Update-Test (Gruppe 5.1) deckt das bereits ab.
Hier einmal der echte Weg, den ein Nutzer geht.

| Nr. | Schritte | Erwartet | Ergebnis |
|---|---|---|---|
| 4.1 | Testprofil anlegen: `"C:\Program Files\Mozilla Firefox\firefox.exe" -CreateProfile CTA-Test`, dann `"C:\Program Files\Mozilla Firefox\firefox.exe" -P CTA-Test -no-remote` | Firefox startet leer, getrennt von deinem normalen Profil | |
| 4.2 | Im Testprofil: about:addons → Zahnrad → „Add-on aus Datei installieren“ → signierte 0.9.0-XPI aus `dist/signing/0.9.0/signed/` | Installation ohne Warnung zu fehlender Signatur; CTA ist dauerhaft installiert | |
| 4.3 | Master-Passwort anlegen, `acceptance-30-synthetic.json` importieren, Popup öffnen (Codes sichtbar). Firefox komplett beenden und mit `-P CTA-Test -no-remote` neu starten | CTA ist noch installiert; das Popup fragt nach dem Master-Passwort und zeigt keine Codes; nach Eingabe sind alle 30 Konten da | |

## 5. Signierte Installation und Update (#19) – nach der Signierung

| Nr. | Schritte | Erwartet | Ergebnis |
|---|---|---|---|
| 5.1 | `npm run verify:signed -- <0.9.0.xpi> dist/signing/0.9.0` und dasselbe für 0.9.1 (docs/SIGNING.md §6) | Jeweils `6/6 checks OK`; SHA-256 notieren | |
| 5.2 | `node test/browser/update-test.mjs --old <0.9.0.xpi> --new <0.9.1.xpi>` (docs/SIGNING.md §7). Läuft allein in einem eigenen Wegwerf-Profil | U-1 bis U-7 und U-signed stehen auf PASS; die Ergebnisdatei bitte mitschicken | |
| 5.3 | Aufräumen: Testprofil `CTA-Test` löschen (about:profiles im Testprofil oder `firefox -P` → Profil löschen → „Dateien löschen“) | Kein Testbuild bleibt auf dem Rechner installiert. Testbuilds nie an andere weitergeben | |

## Bereits automatisch belegt (nicht wiederholen)

| Thema | Beleg |
|---|---|
| Tab durch die Zeilen, Enter und Leertaste kopieren, Sperren und Einstellungen per Tab erreichbar | B8-4, B8-2 (alle CI-Plattformen) |
| Symbol standardmäßig in der Symbolleiste; Alt+Shift+A registriert, kein Konflikt mit Firefox | C6-1, C6-2 |
| Popup-Maße und Scrollen mit 1/25/50/100 Konten; echtes Popup-Fenster | B3-Layouts, B3-real-1…3 |
| Kopieren schreibt den richtigen Code genau einmal (im Popup als Tab; im echten Popup-Fenster nur per `--os-input`, daher 2.2) | B3-copy, B8-4 |
| Windows-Dialoge Speichern, Abbrechen, Fehler, Öffnen, Import | N1–N5 |
| Neustart sperrt, Sitzungsspeicher leer (temporärer und dauerhaft installierter Build) | C2-6, C3-1, U-7 (unsigniert, ESR) |

Rückmeldung bitte als Liste: „1.1 OK, 1.2 Fehler: …“.
