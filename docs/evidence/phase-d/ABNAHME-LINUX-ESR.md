# Linux- und ESR-Abnahme auf Debian 13 – kurze Anleitung für Ralf

Zweck:
- die offenen Punkte aus RELEASE.md §5 und RELEASE-READINESS-1.0.0.md §3 schließen: echte Tasten,
  Dateidialoge und Zwischenablage unter Linux sowie der manuelle Test auf der Mindestversion
  Firefox ESR 140;
- das Ergebnis gilt nur für Linux. macOS bleibt ungetestet.

**Sicherheitsregeln:**
- Nur ein **Wegwerf-Profil** in einem temporären Ordner. Es entsteht kein Eintrag in deiner
  Profilliste, und dein normales Profil bleibt unberührt.
- Deine Firefox-Installation wird **nicht** geändert, entfernt oder aktualisiert. ESR 140 kommt,
  falls nötig, als entpacktes Archiv in einen eigenen Ordner in deinem Home-Verzeichnis.
- Nur synthetische Testdaten, nie echte Konten.
- Signierte CTA-Datei: die signierte 0.9.6, sobald es sie gibt, sonst 0.9.5. Über USB-Stick oder
  Netzwerkfreigabe vom Windows-Rechner kopieren, aus `dist/signing/<version>/signed/`. Vor dem
  Installieren mit `sha256sum` gegen die Prüfsumme in der Abnahme vergleichen.
- Testdaten aus dem öffentlichen Repository: `test/fixtures/acceptance-30-synthetic.json`.

Dauer: etwa 20 Minuten mit dem vorhandenen Firefox, plus 10 Minuten für ESR 140.

## Welche Prüfung braucht welchen Firefox?

| Prüfung | Vorhandener Firefox (Debian) | ESR 140 nötig? |
|---|---|---|
| L-1 Installation der signierten Datei, Datenhinweis „keine Daten“ | ja | **ja**, bei der Mindestversion |
| L-2 Master-Passwort festlegen, Import, Entsperren, Codes stimmen | ja | **ja** (Web Crypto und PBKDF2 auf der ältesten Engine) |
| L-3 Popup: Layout, Scrollen, Schrift, hell und dunkel | ja | **ja** (CSS der ältesten Engine; die CI kann dort Zoom und Design nicht umstellen) |
| L-4 Tastenkürzel Strg+Umschalt+2 mit echter Tastatur, auch im Textfeld | **ja** (Linux-spezifisch) | kurz wiederholen |
| L-5 Klick kopiert, Einfügen in ein Textfeld (X11 oder Wayland) | **ja** (Linux-spezifisch) | nein |
| L-6 Export speichern und Wiederherstellen mit dem GTK-Dateidialog | **ja** (Linux-spezifisch) | nein |
| L-7 Dunkles Desktop-Design wird bei „Automatisch“ übernommen | **ja** (Linux-spezifisch) | nein |
| L-8 Zoom 200 % und schmales Fenster in den Einstellungen | ja | **ja** |
| L-9 Neustart: Tresor gesperrt, Daten bleiben | ja | nein |

## 0. Welche Version ist installiert?

```sh
firefox-esr --version 2>/dev/null; firefox --version 2>/dev/null
```

- Zeigt Debian **140.x**: Teil A erledigt auch Teil B, das Archiv ist nicht nötig.
- Zeigt Debian eine **neuere** Version (zum Beispiel 153.x): Teil A damit, Teil B mit dem
  ESR-140-Archiv.

## A. Mit dem vorhandenen Firefox

```sh
P=$(mktemp -d /tmp/cta-wegwerf-XXXX)
firefox-esr --no-remote --profile "$P"     # oder: firefox --no-remote --profile "$P"
```

1. `about:addons` → Zahnrad → „Add-on aus Datei installieren…“ → die signierte Datei.
2. Einstellungen öffnen, Test-Master-Passwort festlegen (z. B. `Wegwerf-Master-2026!`),
   **Allgemein → Import** → `acceptance-30-synthetic.json`.

| Nr. | Prüfung | Erwartet | Ergebnis |
|---|---|---|---|
| L-1 | Installation | Keine Signaturwarnung. Der Dialog nennt Speicher, Alarme und aktiven Tab und dass **keine Daten** erhoben werden | |
| L-2 | Codes mit einem zweiten Gerät oder Tool für einen Eintrag vergleichen (Schlüssel aus der Fixture-Datei) | Gleicher Code | |
| L-3 | Popup in der Symbolleiste öffnen, ganz nach unten scrollen; Design hell und dunkel | 30 Zeilen, scrollbar, Fußzeile sichtbar, Text nicht abgeschnitten, gut lesbar | |
| L-4 | Eine Website öffnen, **Strg+Umschalt+2**; dann in ein Suchfeld klicken und erneut | Das Popup öffnet sich beide Male. Kein anderes Programm (Desktop, Tastaturbelegung) fängt das Kürzel ab | |
| L-5 | Im Popup auf einen Code klicken, dann in einem Textfeld Strg+V | Der eingefügte Code stimmt | |
| L-6 | **Allgemein → Export und Sicherung**: verschlüsselte Sicherung speichern. Dann **Wiederherstellen**: Datei im Dialog wählen → „Sicherung prüfen“ → **nicht** ersetzen | Der GTK-Dialog öffnet sich und speichert; danach grüne Meldung „Sicherung erfolgreich geprüft …“ und Vorschau „Aktuell 30 Einträge · Sicherung 30 Einträge · in beiden 30.“ | |
| L-7 | Desktop-Einstellungen auf dunkel stellen, CTA-Design „Automatisch“ | Popup und Einstellungen werden dunkel. Danach dein Desktop-Design zurückstellen | |
| L-8 | Einstellungen bei Strg+Plus 200 % und schmalem Fenster | Nichts abgeschnitten, kein waagerechter Scrollbalken | |
| L-9 | Firefox schließen und mit demselben Befehl und demselben `$P` neu starten | Popup ist gesperrt; nach dem Entsperren sind alle 30 Einträge da | |

Danach: Firefox schließen, `rm -rf "$P"` und die Export-Datei löschen.

## B. Mit Firefox ESR 140 (nur wenn Debian nicht 140.x hat)

Das Archiv kommt von Mozilla und läuft aus einem eigenen Ordner. Es installiert nichts.

```sh
mkdir -p ~/cta-esr140 && cd ~/cta-esr140
V=140.17.0esr   # die letzte 140er Version aus https://ftp.mozilla.org/pub/firefox/releases/
wget "https://ftp.mozilla.org/pub/firefox/releases/$V/linux-x86_64/de/firefox-$V.tar.xz"
wget "https://ftp.mozilla.org/pub/firefox/releases/$V/SHA256SUMS"
grep " linux-x86_64/de/firefox-$V.tar.xz$" SHA256SUMS
sha256sum "firefox-$V.tar.xz"     # beide Prüfsummen müssen gleich sein
tar xf "firefox-$V.tar.xz"
mkdir -p firefox/distribution
echo '{"policies":{"DisableAppUpdate":true}}' > firefox/distribution/policies.json
P=$(mktemp -d /tmp/cta-esr140-XXXX)
./firefox/firefox --no-remote --profile "$P"
```

- Die Richtlinie `DisableAppUpdate` gilt nur für diesen Ordner. Sie verhindert, dass sich das
  Archiv selbst auf eine neuere Version aktualisiert.
- Erhält ESR 140 keine Sicherheitsupdates mehr, nur für diesen Test benutzen und keine anderen
  Websites öffnen.
- In `about:support` bestätigen, dass die Version 140.x ist.

Dann aus Teil A wiederholen: **L-1, L-2, L-3, L-4 und L-8**. Ergebnis jeweils als „L-3 (ESR 140) OK“.

Aufräumen: Firefox schließen, `rm -rf "$P" ~/cta-esr140`.

## Rückmeldung

Bitte als Liste:
- die Firefox-Version(en) aus `about:support`;
- die Desktop-Umgebung, also GNOME oder KDE, X11 oder Wayland;
- dann „L-1 OK, L-6 Fehler: …“.

Bilder nur mit synthetischen Einträgen.
