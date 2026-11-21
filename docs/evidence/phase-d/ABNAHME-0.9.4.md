# Abnahme mit 0.9.4 – Checkliste für Ralf

Offen sind nur noch die 1.0-Blocker **#6** (Tastenkürzel) und **#25** (Tresor ersetzen) sowie
eine optische Nachprüfung der Kontozeilen. Der signierte Update-Test 0.9.3 → 0.9.4 ist
automatisch bestanden, siehe [signed-update-0.9.4/README.md](signed-update-0.9.4/README.md).

Signierte Datei: `dist/signing/0.9.4/signed/b6d63835a4834f55a37a-0.9.4.xpi`
(SHA-256 `acc46d30364e8674ee2be61c7471d0852006a9d57f1574f380494d38b3f69aaf`, Quelle `68407dd`).

**Zwei Profile, nur Testdaten:**

- **`CTA-Test`** (deine vorhandenen Testeinträge): nur das Upgrade und Prüfungen, die nichts
  löschen oder ersetzen (Teile 0, 1 und 3). In diesem Profil **nicht** ersetzen, wiederherstellen
  oder verwerfen.
- **`CTA-Wegwerf`** (neu, nur synthetische Daten): alles, was den Tresor ersetzt (Teil 2) und das
  eigene Kürzel (1.5). Das Profil wird am Ende gelöscht.
- Trage nie echte Konten ein. Dein normales Profil bleibt unberührt.

Trage pro Punkt **OK**, **Fehler: …** oder **nicht möglich** ein. Ein Punkt ist OK, wenn alles in
der Spalte „Erwartet“ zutrifft, sonst Fehler. Dauer gesamt etwa 30 Minuten.

## 0. Upgrade auf 0.9.4 im Profil CTA-Test (ohne Deinstallieren)

1. Testprofil starten:
   `& "C:\Program Files\Mozilla Firefox\firefox.exe" -P CTA-Test -no-remote`
2. Vorher in `about:addons` → Zahnrad → „Erweiterungs-Tastenkombinationen verwalten“
   nachsehen und notieren, welches Kürzel bei Compact TOTP Authenticator steht. Wenn du es in
   0.9.3 selbst auf Strg+Umschalt+2 gesetzt hast, bleibt es bei dir eingestellt (das ist dann ein
   eigenes Kürzel).
3. `about:addons` → Zahnrad → „Add-on aus Datei installieren…“ → die Datei aus
   `C:\Workspace\compact-totp-authenticator\dist\signing\0.9.4\signed\` → „Hinzufügen“ bzw.
   „Aktualisieren“. **Nicht** vorher entfernen.

| Nr. | Prüfung | Erwartet | Ergebnis |
|---|---|---|---|
| 0.1 | `about:addons` → Compact TOTP Authenticator | Version **0.9.4**, keine Signaturwarnung | |
| 0.2 | Popup öffnen, mit deinem Test-Master-Passwort entsperren | Alle bisherigen Testeinträge sind da, in derselben Reihenfolge | |
| 0.3 | Einstellungen → Darstellung und Allgemein → Verhalten ansehen | Design, Schriftgröße, Zeilenhöhe, Sortierung und Sperrzeit wie vor dem Upgrade | |

## 1. Tastenkürzel (#6)

| Nr. | Prüfung | Erwartet | Ergebnis |
|---|---|---|---|
| 1.1 | `about:addons` → Zahnrad → „Erweiterungs-Tastenkombinationen verwalten“ | Bei „Schaltfläche für Symbolleiste aktivieren“ steht **Strg+Umschalt+2** (oder das Kürzel, das du vor dem Upgrade notiert hast, falls du in 0.9.3 selbst eines gesetzt hattest) | |
| 1.2 | Eine normale Webseite öffnen (z. B. `https://example.com`), in die Seite klicken, Popup geschlossen: **Strg+Umschalt+2** | Das CTA-Popup öffnet sich, sonst passiert nichts (kein Menü, kein neuer Tab) | |
| 1.3 | Auf einer Webseite mit Textfeld (z. B. die Suche auf `https://www.mozilla.org`) ins Textfeld klicken: **Strg+Umschalt+2** | Das Popup öffnet sich; im Textfeld erscheint kein Zeichen | |
| 1.4 | **Alt+Umschalt+A** drücken | CTA reagiert nicht. Dass Firefox das Menü „Ansicht“ öffnet, ist normal (Esc schließt es) | |
| 1.5 | Eigenes Kürzel bleibt erhalten: im Profil **CTA-Wegwerf**, siehe Teil 2, Vorbereitung Schritt 4 und Punkt 2.0 | | |

Kurz notieren, falls ein anderes Programm (z. B. ein Tastatur- oder Grafiktreiber-Tool) Strg+Umschalt+2 abfängt.

## 2. Tresor ersetzen (#25) – nur im Profil CTA-Wegwerf

Vorbereitung (einmalig, etwa 5 Minuten):
1. Firefox ganz schließen, dann ein neues Profil anlegen und starten:
   `& "C:\Program Files\Mozilla Firefox\firefox.exe" -CreateProfile CTA-Wegwerf`
   `& "C:\Program Files\Mozilla Firefox\firefox.exe" -P CTA-Wegwerf -no-remote`
2. `about:addons` → Zahnrad → „Add-on aus Datei installieren…“ → zuerst **0.9.3** aus
   `dist\signing\0.9.3\signed\`.
3. Einstellungen öffnen, ein Test-Master-Passwort festlegen (z. B. `Wegwerf-Master-2026!`).
   **Allgemein → Import**: `C:\Workspace\compact-totp-authenticator\test\fixtures\acceptance-30-synthetic.json`
   wählen und mit dem Master-Passwort importieren (30 synthetische Einträge).
4. `about:addons` → Zahnrad → „Erweiterungs-Tastenkombinationen verwalten“ → das Kürzel für
   Compact TOTP Authenticator auf **Strg+Umschalt+9** setzen.
5. Jetzt **0.9.4** aus `dist\signing\0.9.4\signed\` darüber installieren.
6. In **2FA-Einträge** bei „Test Alpha“ als Website eintragen:
   `https://anmeldung.sehr-lange-subdomain.beispiel-unternehmen-mit-langem-namen.example/pfad/zur/anmeldung?weiter=ja`
7. **Allgemein → Export und Sicherung** → „Verschlüsselte CTA-Sicherung“, Export-Passwort z. B.
   `Exportpasswort-2026!`, Master-Passwort → Exportieren, Datei speichern.
8. In **2FA-Einträge** einen Eintrag „Neu nach Export“ hinzufügen (Schlüssel z. B.
   `JBSWY3DPEHPK3PXP`) und „Test Bravo“ löschen.

| Nr. | Prüfung | Erwartet | Ergebnis |
|---|---|---|---|
| 2.0 | Nach Schritt 5: Kürzelverwaltung ansehen, dann **Strg+Umschalt+9** und **Strg+Umschalt+2** auf einer Webseite drücken | Dort steht weiter **Strg+Umschalt+9**; Strg+Umschalt+9 öffnet das Popup, Strg+Umschalt+2 nicht | |
| 2.1 | **Allgemein → Wiederherstellen** ansehen | Überschrift „Wiederherstellen: Tresor durch eine verschlüsselte Sicherung ersetzen“; klar erkennbar anders als „Import: Einträge hinzufügen“; „Schritt 1: Sicherung prüfen – ändert noch nichts“ | |
| 2.2 | Datei wählen, **falsches** Export-Passwort → „Sicherung prüfen“ | Meldung direkt unter Schritt 1: „Die Sicherung ließ sich nicht entschlüsseln: Das Export-Passwort ist falsch oder die Datei ist beschädigt …“; nichts geändert | |
| 2.3 | Richtiges Export-Passwort → „Sicherung prüfen“ | Die Seite springt von selbst zu „Schritt 2: Ersetzen bestätigen“, der Fokus steht dort (mit Tab geht es zu den Feldern von Schritt 2); unter Schritt 1 steht nur „Sicherung geprüft, noch nichts geändert. Weiter mit Schritt 2.“ | |
| 2.4 | Schritt 2 lesen | Vorschau mit Anzahl; rote Warnung; „Neu nach Export“ steht unter „Diese … Einträge gibt es nur in deinem aktuellen Tresor …“; der Text „Warum noch einmal? …“ erklärt verständlich, warum Export-Passwort und Master-Passwort erneut nötig sind | |
| 2.5 | Häkchen setzen, Export-Passwort erneut, **falsches** Master-Passwort → „Tresor ersetzen“ | Meldung „Das Master-Passwort dieses Tresors ist falsch. Es wurde nichts wiederhergestellt.“ direkt unter den Knöpfen von Schritt 2, nirgends sonst eine Meldung; nichts geändert | |
| 2.6 | Ohne Häkchen versuchen | Ersetzen ist nicht möglich | |
| 2.7 | Häkchen, Export-Passwort, richtiges Master-Passwort → „Tresor ersetzen“ | Schritt 2 schließt sich; unter Schritt 1 steht eindeutig „Tresor ersetzt: Er enthält jetzt die 30 2FA-Einträge der Sicherung. Dein bisheriger Stand mit 30 Einträgen ist verschlüsselt aufbewahrt …“; keine alte Meldung sichtbar | |
| 2.8 | **2FA-Einträge** und Popup ansehen | Wie beim Export: „Test Bravo“ wieder da, „Neu nach Export“ weg; Master-Passwort unverändert | |
| 2.9 | **Master-Passwort ändern** ansehen, nicht absenden | Neutraler grauer Hinweis „Nur wichtig, wenn du das Master-Passwort änderst …“ (keine rote Fehlermeldung) | |
| 2.10 | Box „Vorheriger Tresorstand“: Häkchen + Master-Passwort → „Vorherigen Tresor wiederherstellen“ | Meldung „Vorheriger Tresor wiederhergestellt: 30 2FA-Einträge …“ direkt in der Box; der Stand mit „Neu nach Export“ ist zurück | |
| 2.11 | Zum Schluss: Häkchen + Master-Passwort → „Vorherigen Tresor verwerfen“ | Meldung „Der vorherige Tresorstand wurde gelöscht.“; die Box verschwindet | |

## 3. Kontozeilen und Zoom (optisch)

Im Profil CTA-Wegwerf (Eintrag „Test Alpha“ mit langer Website aus Schritt 6), auf Wunsch auch
in CTA-Test mit eigenen Testeinträgen mit Website.

| Nr. | Prüfung | Erwartet | Ergebnis |
|---|---|---|---|
| 3.1 | **2FA-Einträge** bei normalem Zoom (Strg+0) | In jeder Zeile stehen ↑ ↓ „Bearbeiten“ „Löschen“ auf **einer** Linie, rechtsbündig untereinander; die lange Website bricht stattdessen um | |
| 3.2 | Maus über ↑ halten | Tooltip „Hoch“ | |
| 3.3 | Strg+Plus bis 150 %, dann 200 % | Kein waagerechter Scrollbalken; die Knöpfe bleiben einzeilig (bei 200 % darf die Spalte „Typ“ verschwinden) | |
| 3.4 | Fenster schmal ziehen (etwa halbe Bildschirmbreite) | Kein waagerechter Scrollbalken; alles bedienbar. Danach Strg+0 | |

## Aufräumen

1. Die Export-Datei aus Schritt 7 löschen.
2. Firefox schließen. `about:profiles` in deinem normalen Firefox → Profil **CTA-Wegwerf** →
   „Entfernen“ → „Dateien löschen“.

Rückmeldung bitte als Liste: „0.1 OK, 2.3 Fehler: …“.
