# Abnahme auf Debian 13 (Linux) und Firefox ESR 140 – kurze Anleitung für Ralf

Status: **vorbereitet, noch nicht durchgeführt.** Die Ergebnisse trage ich erst nach deiner
Rückmeldung ein.

Zweck:
- echte Tastatur, Zwischenablage, Dateidialog und Darstellung unter Linux prüfen;
- Firefox ESR 140, die kleinste unterstützte Version, einmal von Hand prüfen (RELEASE.md §5);
- das Ergebnis gilt nur für Linux; macOS bleibt ungetestet.

**Sicherheitsregeln:**
- Nur ein **Wegwerf-Profil** in einem temporären Ordner. Es erscheint nicht in deiner
  Profilliste. Dein normales Firefox-Profil wird nicht geöffnet und nicht geändert.
- Dein installierter Firefox wird **nicht** geändert, ersetzt oder aktualisiert. ESR 140 kommt,
  falls nötig, als entpacktes Archiv in einen eigenen Ordner in deinem Home-Verzeichnis (Teil B).
- Nur synthetische Testdaten, nie echte Konten.

Dauer: etwa 20 Minuten, plus 10 Minuten, falls Teil B nötig ist.

## Vorbereitung: zwei Dateien vom Windows-Rechner

Per USB-Stick oder Netzwerkfreigabe nach `~/cta-test/` kopieren:

1. die signierte 0.9.6:
   `C:\Workspace\compact-totp-authenticator\dist\signing\0.9.6\signed\b6d63835a4834f55a37a-0.9.6.xpi`
2. die Testdaten: `C:\Workspace\compact-totp-authenticator\test\fixtures\acceptance-30-synthetic.json`

Prüfsumme vergleichen:

```sh
cd ~/cta-test
sha256sum b6d63835a4834f55a37a-0.9.6.xpi
```

Erwartet: `c7000043e886da55e43f347f0a4af3bd724ae8908fb80cba1d223b6d6e8cd48f`. Bei einem anderen
Wert nicht installieren, sondern mir den Wert melden.

## 0. Welcher Firefox ist installiert?

```sh
firefox-esr --version 2>/dev/null; firefox --version 2>/dev/null; command -v flatpak >/dev/null && flatpak list | grep -i firefox
```

| Ausgabe | Bedeutung | Weiter mit |
|---|---|---|
| `Mozilla Firefox 140.…esr` | ESR 140, die Mindestversion | Teil A. Teil B ist damit erledigt |
| `Mozilla Firefox 1xx.…esr` (größer als 140, z. B. 153) | neuere ESR | Teil A mit `firefox-esr`, danach Teil B |
| `Mozilla Firefox 1xx.…` ohne `esr` | normale Version | Teil A mit `firefox`, danach Teil B |
| Nur eine Flatpak-Zeile | Flatpak-Firefox | erst mir melden; der temporäre Profilordner muss dann anders liegen |

Den Befehl aus der ersten Spalte (`firefox-esr` oder `firefox`) nennt die Anleitung unten `FF`.

## A. Mit dem installierten Firefox

Firefox darf dabei geöffnet bleiben; `--no-remote` startet eine getrennte Instanz.

```sh
FF=firefox-esr        # oder: FF=firefox
P=$(mktemp -d /tmp/cta-wegwerf-XXXX); echo "$P"
$FF --no-remote --profile "$P"
```

1. `about:addons` → Zahnrad → „Add-on aus Datei installieren…“ → `~/cta-test/…-0.9.6.xpi` →
   „Hinzufügen“.
2. Die CTA-Einstellungen öffnen sich. Test-Master-Passwort festlegen, z. B.
   `Wegwerf-Master-2026!`.
3. **Allgemein → Import** → `~/cta-test/acceptance-30-synthetic.json`.

| Nr. | Prüfung | Erwartet | Ergebnis |
|---|---|---|---|
| L-1 | Installation | Keine Signaturwarnung. Der Dialog nennt Speicher, Alarme und aktiven Tab und dass **keine Daten** erhoben werden. `about:addons` zeigt 0.9.6 | |
| L-2 | Einen Eintrag mit einem zweiten Gerät oder Tool vergleichen; den Schlüssel aus der Testdatei nehmen | Gleicher Code | |
| L-3 | **Popup öffnen und entsperren:** CTA-Knopf in der Symbolleiste (falls nicht sichtbar: Puzzle-Symbol → anheften) → Master-Passwort → Enter | Das Passwortfeld hat sofort den Fokus; nach Enter erscheinen 30 Zeilen | |
| L-4 | **Echte Tastatur:** eine Website öffnen, **Strg+Umschalt+2**; dann in ein Suchfeld der Seite klicken und erneut drücken | Das Popup öffnet sich beide Male. Kein anderes Programm fängt das Kürzel ab, weder der Desktop noch die Tastaturbelegung | |
| L-5 | Im Popup auf einen Code klicken, dann in einem Textfeld Strg+V | Grüner Haken; der eingefügte Code stimmt | |
| L-6 | **Tastatur im Popup:** Strg+Umschalt+2, dann Tab, Tab, Enter; danach Strg+V in einem Textfeld | Ein deutlicher Rahmen zeigt die fokussierte Zeile. Enter kopiert genau deren Code. Der Rahmen bleibt nach dem Code-Wechsel (Zähler bei 30) auf derselben Zeile. Umschalt+Tab geht zurück, Escape schließt das Popup | |
| L-7 | **Tastatur in den Einstellungen:** mit Tab zur Tab-Leiste, dann Pfeil rechts und links, Pos1, Ende | Die Tabs wechseln; der aktive Tab hat einen deutlich sichtbaren Rahmen | |
| L-8 | **Darstellung:** Einstellungen → Darstellung → Design Hell, dann Dunkel; jeweils das Popup ansehen und ganz nach unten scrollen | Beide Designs gut lesbar. 30 Zeilen, scrollbar, Fußzeile sichtbar, nichts abgeschnitten | |
| L-9 | Desktop-Design auf dunkel stellen, CTA-Design „Automatisch“ | Popup und Einstellungen werden dunkel. Danach dein Desktop-Design zurückstellen | |
| L-10 | Einstellungen bei Strg+Plus bis 200 % und in einem schmalen Fenster; danach Strg+0 | Nichts abgeschnitten, kein waagerechter Scrollbalken | |
| L-11 | **Allgemein → Export und Sicherung:** verschlüsselte Sicherung speichern (Export-Passwort z. B. `Exportpasswort-2026!`). Dann **Wiederherstellen:** die Datei im Dialog wählen → „Sicherung prüfen“ → **nicht** ersetzen | Der Linux-Dateidialog öffnet sich und speichert. Danach grüne Meldung „Sicherung erfolgreich geprüft …“ und Vorschau mit 30 Einträgen | |
| L-12 | Wegwerf-Firefox schließen und mit `$FF --no-remote --profile "$P"` neu starten (im selben Terminal) | Das Popup ist gesperrt; nach dem Entsperren sind alle 30 Einträge da | |

Aufräumen Teil A:
1. Nur den Wegwerf-Firefox schließen.
2. `echo "$P"` muss mit `/tmp/cta-wegwerf-` beginnen. Erst dann: `rm -rf "$P"`.
3. Die Export-Datei aus L-11 löschen.

## B. Mit Firefox ESR 140 (nur wenn Teil 0 nicht 140.x gezeigt hat)

Das Archiv kommt direkt von Mozilla, läuft aus `~/cta-esr140` und installiert nichts. Der
System-Firefox und dein Profil bleiben unverändert. Dafür nur ein neues Wegwerf-Profil nehmen,
nie das aus Teil A: ein Profil einer neueren Version darf nicht mit einer älteren geöffnet werden.

```sh
mkdir -p ~/cta-esr140 && cd ~/cta-esr140
V=140.17.0esr
wget "https://ftp.mozilla.org/pub/firefox/releases/$V/linux-x86_64/de/firefox-$V.tar.xz"
wget "https://ftp.mozilla.org/pub/firefox/releases/$V/SHA256SUMS"
grep " linux-x86_64/de/firefox-$V.tar.xz$" SHA256SUMS
sha256sum "firefox-$V.tar.xz"     # beide Prüfsummen müssen gleich sein
tar xf "firefox-$V.tar.xz"
mkdir -p firefox/distribution
echo '{"policies":{"DisableAppUpdate":true}}' > firefox/distribution/policies.json
P=$(mktemp -d /tmp/cta-esr140-XXXX); echo "$P"
./firefox/firefox --no-remote --profile "$P"
```

- Meldet `wget` „404“, mir Bescheid geben. Bitte keine andere Version raten.
- `DisableAppUpdate` gilt nur für diesen Ordner. So aktualisiert sich das Archiv nicht selbst.
- ESR 140 bekommt keine Sicherheitsupdates mehr. Nur für diesen Test benutzen und keine anderen
  Websites öffnen. Für L-4 genügt `about:blank` mit einem Textfeld, etwa die Adressleiste.
- In `about:support` bestätigen, dass die Version 140.x ist.

Dann Installation, Master-Passwort und Import wie in Teil A und diese Punkte wiederholen:
**L-1, L-2, L-3, L-4, L-6, L-8 und L-10**. Ergebnis jeweils als „L-3 (ESR 140) OK“.

Aufräumen Teil B: den ESR-Firefox schließen. `echo "$P"` muss mit `/tmp/cta-esr140-` beginnen.
Dann: `rm -rf "$P" ~/cta-esr140`.

Zum Schluss `rm -rf ~/cta-test`.

## Rückmeldung

Bitte als Liste:
- die Firefox-Version(en) aus `about:support`;
- die Desktop-Umgebung, also GNOME oder KDE, X11 oder Wayland;
- dann „L-1 OK, L-6 Fehler: …“, für Teil B mit „(ESR 140)“.

Bildschirmfotos nur mit synthetischen Einträgen.
