# Abnahme mit 0.9.3 – Checkliste für Ralf

Nur noch die Punkte, die für die 1.0-Blocker #2, #3, #6, #21 und #25 wirklich offen sind.
Alles andere ist automatisch belegt (siehe die Issue-Kommentare).

**Nur Testdaten:**
- Arbeite im Profil `CTA-Test` mit den synthetischen Einträgen, die dort schon liegen.
- Trage nie echte Konten ein. Dein normales Profil bleibt unberührt.

Trage pro Punkt **OK**, **Fehler: …** oder **nicht möglich** ein. Dauer gesamt etwa 25 Minuten.

## 0. Upgrade auf 0.9.3 (ohne Deinstallieren)

1. Testprofil starten:
   `& "C:\Program Files\Mozilla Firefox\firefox.exe" -P CTA-Test -no-remote`
2. `about:addons` → Zahnrad → „Add-on aus Datei installieren…“ → die Datei aus
   `C:\Workspace\compact-totp-authenticator\dist\signing\0.9.3\signed\` wählen →
   „Hinzufügen“ bzw. „Aktualisieren“.
3. **Nicht** vorher entfernen. Das Upgrade behält deine Testeinträge und Einstellungen.

| Nr. | Prüfung | Erwartet | Ergebnis |
|---|---|---|---|
| 0.1 | `about:addons` → Compact TOTP Authenticator | Version **0.9.3**, keine Signaturwarnung | |
| 0.2 | Popup öffnen, mit deinem Test-Master-Passwort entsperren | Alle bisherigen Testeinträge sind da, in derselben Reihenfolge | |

## 1. Popup-Darstellung (#2)

| Nr. | Prüfung | Erwartet | Ergebnis |
|---|---|---|---|
| 1.1 | Einstellungen → **Darstellung** → Hell, dann Dunkel, dann Automatisch (bei Automatisch den Windows-Farbmodus umschalten); jeweils das echte Popup öffnen | Jedes Design gut lesbar; Automatisch folgt Windows | |
| 1.2 | Schriftgröße 12 px, Popup ansehen; dann 20 px | Nichts abgeschnitten oder überlappend; die Liste scrollt weiter bis zum letzten Eintrag | |
| 1.3 | Mit der Maus langsam über die Zeilen im Popup fahren | Dezente, gut erkennbare Hervorhebung; nichts verspringt | |
| 1.4 | Einen Eintrag mit Website `example.com` anlegen oder bearbeiten, example.com öffnen, dann das Popup | Genau dieser Eintrag ist markiert | |

Danach: Darstellung → „Darstellung auf Standard zurücksetzen“.

## 2. Tastatur und Kürzel (#3, #6)

| Nr. | Prüfung | Erwartet | Ergebnis |
|---|---|---|---|
| 2.1 | Popup geschlossen: **Alt+Shift+A** | Das Popup öffnet sich | |
| 2.2 | Im Popup nur Tastatur: Tab → Tab → Enter, dann mit Strg+V in ein Textfeld einfügen | Sichtbarer Rahmen um die Zeile; Enter kopiert genau deren Code (grüner Haken) | |
| 2.3 | Eine Zeile per Tab fokussieren und bis zum nächsten Code-Wechsel (Zähler auf 30) warten | Der Rahmen bleibt auf derselben Zeile | |
| 2.4 | In deinem **normalen** Firefox nur nachsehen, nichts installieren: `about:addons` → Zahnrad → „Erweiterungs-Tastenkombinationen verwalten“ | Keine andere Erweiterung nutzt Alt+Shift+A | |

## 3. Einstellungen mit Tabs (#21)

| Nr. | Prüfung | Erwartet | Ergebnis |
|---|---|---|---|
| 3.1 | Einstellungen öffnen | Drei Tabs **2FA-Einträge** (aktiv), **Darstellung**, **Allgemein**; Design passt zu Hell/Dunkel | |
| 3.2 | Nur Tastatur: mit Tab zur Tab-Leiste, dann Pfeil rechts/links, Pos1, Ende | Tabs wechseln, deutlich sichtbarer Rahmen am aktiven Tab | |
| 3.3 | Tab **Allgemein** ansehen | Abschnitte: Verhalten (Sortierung, automatische Sperre, Leerlauf), Master-Passwort ändern, Import, Export und Sicherung, Wiederherstellen | |
| 3.4 | In **Allgemein → Verhalten** die Sortierung auf A–Z stellen | Meldung „Gespeichert“ direkt im Abschnitt; der Tab bleibt; das Popup sortiert A–Z. Danach wieder „Manuell“ | |
| 3.5 | In **2FA-Einträge** im Formular einen Namen eintippen (nicht speichern), zu **Darstellung** und zurück wechseln | Der getippte Name ist noch da | |
| 3.6 | In **Allgemein → Master-Passwort ändern** etwas ins Feld „Aktuelles Master-Passwort“ tippen (nicht absenden), zu einem anderen Tab und zurück | Das Passwortfeld ist leer | |
| 3.7 | Strg+Plus bis 150 %, alle drei Tabs ansehen; danach Strg+0 | Kein waagerechter Scrollbalken, alles bedienbar | |

## 4. Tresor aus Sicherung ersetzen (#25)

Vorbereitung:
1. **Allgemein → Export und Sicherung** → „Verschlüsselte CTA-Sicherung“. Ein Export-Passwort
   ausdenken, z. B. `Exportpasswort-2026!`, Master-Passwort eingeben → Exportieren. Die Datei
   speichern.
2. Danach in **2FA-Einträge** einen Eintrag „Neu nach Export“ hinzufügen (synthetischer
   Schlüssel, z. B. aus `test/fixtures/legacy-synthetic.json`) und einen anderen Eintrag löschen.

| Nr. | Prüfung | Erwartet | Ergebnis |
|---|---|---|---|
| 4.1 | **Allgemein → Wiederherstellen**: die Datei wählen, **falsches** Export-Passwort → „Sicherung prüfen“ | Klare Meldung im Abschnitt: Export-Passwort falsch oder Datei beschädigt; nichts geändert | |
| 4.2 | Richtiges Export-Passwort → „Sicherung prüfen“ | Vorschau mit Anzahl; rote Warnung; „Neu nach Export“ steht unter „gibt es nur in deinem aktuellen Tresor“; Feld Export-Passwort leer | |
| 4.3 | Häkchen setzen, Export-Passwort erneut, **falsches** Master-Passwort → „Tresor ersetzen“ | Meldung „Master-Passwort falsch“; nichts geändert | |
| 4.4 | Export-Passwort erneut, richtiges Master-Passwort, Häkchen → „Tresor ersetzen“ | Meldung „Tresor ersetzt …“; die Einträge entsprechen dem Export (gelöschter wieder da, „Neu nach Export“ weg); Box „Vorheriger Tresorstand vom …“ erscheint | |
| 4.5 | Popup öffnen | Zeigt die ersetzten Einträge; das Master-Passwort ist unverändert | |
| 4.6 | **Master-Passwort ändern** ansehen, nicht absenden | Warnung, dass der vorherige Tresorstand beim Ändern gelöscht würde, mit Pflicht-Häkchen | |
| 4.7 | Box „Vorheriger Tresorstand“: Häkchen + Master-Passwort → „Vorherigen Tresor wiederherstellen“ | Der Stand mit „Neu nach Export“ ist zurück; der ersetzte Stand ist jetzt der vorherige | |
| 4.8 | Zum Schluss: Häkchen + Master-Passwort → „Vorherigen Tresor verwerfen“ | Meldung „gelöscht“; die Box verschwindet | |

Die Export-Datei danach löschen.

Rückmeldung bitte als Liste: „0.1 OK, 1.2 Fehler: …“.
