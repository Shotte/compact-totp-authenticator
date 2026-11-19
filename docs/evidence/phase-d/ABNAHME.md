# Abnahme-Checkliste für Ralf (Phase D)

Arbeite **nur mit Testdaten**:
- ein frisches Firefox-Profil;
- die Datei `test/fixtures/legacy-synthetic.json` für den Import;
- ein ausgedachtes Master-Passwort.

Keine echten TOTP-Konten.

Trage pro Punkt ein: **OK**, **Fehler** (mit kurzer Beschreibung) oder **nicht möglich**.
Punkte, die einen Linux- oder macOS-Desktop brauchen, bleiben MANUAL_REVIEW, solange
keiner verfügbar ist.

## Vorbereitung (5 Min.)

1. Im Repository: `npm start` öffnet Firefox mit CTA als temporärem Add-on.
   - Alternativ: about:debugging → „Temporäres Add-on laden“ → `src/manifest.json`.
2. Im Popup auf Einstellungen und ein Master-Passwort anlegen.
3. Einstellungen → Import → `legacy-synthetic.json` wählen. Das Konto ohne Namen behält
   „Ohne Namen 1“. Master-Passwort eingeben → „Importieren“. Es entstehen 6 Konten.

## A. Popup und Bedienung (#2, #3) – ca. 10 Min.

| # | Prüfung | Ergebnis |
|---|---|---|
| A1 | Klick auf das CTA-Symbol: Das Popup öffnet sich, ist schmal (270 px), Zeilen kompakt, Fußleiste unten fest | |
| A2 | Mehr als 20 Konten anlegen (oder die Import-Datei zweimal mit anderen Namen): Die Liste scrollt bis zum letzten Konto, die Fußleiste bleibt sichtbar | |
| A3 | Maus: Überfahren hebt die Zeile dezent hervor; Klick auf Name, Code oder Symbol kopiert den Code (grüner Haken) | |
| A4 | Einfügen in ein Textfeld: Der kopierte Code ist korrekt (Vergleich mit einer anderen TOTP-App, in die du den Schlüssel von „Example Mail“ aus der Testdatei einträgst) | |
| A5 | Nur Tastatur: Alt+Shift+A öffnet das Popup; Tab wandert durch die Zeilen mit sichtbarem Rahmen; Enter oder Leertaste kopiert; Sperren und Einstellungen sind per Tab erreichbar | |
| A6 | Auf einer Website, deren Adresse bei einem Konto eingetragen ist: Dieses Konto ist im Popup hervorgehoben | |

## B. Darstellung (#2) – ca. 5 Min.

| # | Prüfung | Ergebnis |
|---|---|---|
| B1 | Einstellungen → Design hell, dunkel, automatisch (Windows-Farbmodus umschalten, während das Popup offen ist): Alles bleibt lesbar | |
| B2 | Eigene Farben und Schriftgröße 12 und 20 px: Nichts ist abgeschnitten. Bei zu geringem Kontrast passt CTA die Textfarbe an und zeigt einen Hinweis | |

## C. Symbolleiste und Kürzel (#6) – ca. 2 Min.

| # | Prüfung | Ergebnis |
|---|---|---|
| C1 | Nach der Installation ist das Symbol direkt in der Symbolleiste, nicht im Überlaufmenü | |
| C2 | Alt+Shift+A öffnet das Popup. about:addons → Zahnrad → „Tastenkombinationen verwalten“: Kein anderes Add-on nutzt sie | |

## D. Native Datei-Dialoge (#5) – ca. 5 Min. unter Windows

| # | Prüfung | Ergebnis |
|---|---|---|
| D1 | Einstellungen → Import → „Durchsuchen…“ öffnet den Windows-Dialog; die Datei lässt sich wählen; die Vorschau erscheint | |
| D2 | Export (verschlüsselt) mit „Jedes Mal nachfragen, wo gespeichert werden soll“ (Firefox-Einstellung): Der Speichern-Dialog erscheint und das Speichern klappt; Abbrechen speichert nichts | |
| D3 | Wiederherstellen: In einem neuen Profil mit neuem Master-Passwort die gespeicherte Datei über den Öffnen-Dialog wählen. Export-Passwort und Master-Passwort eingeben: Alle Konten sind wieder da | |
| D4 | macOS: D1–D3 wiederholen | MANUAL_REVIEW (kein Mac verfügbar) |
| D5 | Linux-Desktop: D1–D3 wiederholen | MANUAL_REVIEW (kein Linux-Desktop verfügbar) |

## E. Signierte Installation, Update und Neustart (#4, signierter Update-Test)

Erst nach der Signierung von 0.9.0 und 0.9.1 (docs/SIGNING.md).

| # | Prüfung | Ergebnis |
|---|---|---|
| E1 | `node test/browser/update-test.mjs --old <0.9.0.xpi> --new <0.9.1.xpi>` läuft durch. Alle Punkte U-1 bis U-7 und U-signed stehen auf PASS | |
| E2 | Das signierte 0.9.0 im normalen Firefox über about:addons → „Add-on aus Datei installieren“ installieren: Es bleibt nach einem Firefox-Neustart installiert | |
| E3 | Mit Testkonten entsperren, Firefox komplett beenden und neu starten: Das Popup fragt nach dem Master-Passwort und zeigt keine Codes | |
| E4 | Danach CTA wieder entfernen (Testprofil oder about:addons → Entfernen) | |

## F. Optional

| # | Prüfung | Ergebnis |
|---|---|---|
| F1 | Sprachausgabe (Windows-Sprachausgabe oder NVDA): Die Zeilen nennen Name und Code | |
| F2 | Windows-Skalierung 150 % oder 200 %: Das Popup ist scharf und vollständig | |
| F3 | Mausklick-Test auf das echte Popup zu einem vereinbarten Zeitpunkt (`npm run test:browser:os`, bewegt kurz die Maus) | |

Rückmeldung bitte als Liste „A1 OK, A2 Fehler: …“. Die Issues #2–#6 bleiben offen, bis du
die zugehörigen Punkte bestätigt hast.
