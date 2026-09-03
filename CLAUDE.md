# Device Saver

Custom Component für Home Assistant: `device_saver`.
**Quelle ist dieses Repo** — seit v1.0.0 (29.08.2026) wird über HACS deployt, nicht mehr von Hand per SSH:
Tag + GitHub-Release erstellen → `ha_manage_hacs(action="update_information")` (HACS pollt sonst nur alle ~48 h)
→ `ha_manage_hacs(action="download", version="vX.Y.Z")` → HA-Restart. Der Pfad auf dem Server
(`/homeassistant/custom_components/device_saver/`) ist dann HACS-verwaltet — nicht mehr direkt editieren,
sonst weicht HACS' Buchhaltung vom Dateistand ab (war bis 29.08. der Fall: HACS meldete v0.0.11, live lief v0.0.17).

## SSH-Zugang
```
ssh has
```
Config: Host `has`, HostName `has.sood4.ch`, User `advanced_ssh`, Key `~/.ssh/ha_key`

## HA Logs
Kein `home-assistant.log` vorhanden — siehe `ha_quirks.md` → "HA Logs". Nutze MCP `ha_get_logs`.

## Funktionsweise
- Auto-Discovery aller Devices, O(n) Cache-Build
- Ignored Integrations/Platforms: seit v0.0.16 über Options-Flow „Einstellungen" konfigurierbar (`ignored_integrations`, `ignored_platforms`); Defaults: Integrations `{"unifi", "browser_mod"}`, Platforms `{"battery_notes", "unifi"}` (in `const.py`)
- Startup-Grace (v0.0.16): In den ersten 5 min nach Start (`STARTUP_GRACE_MIN`) werden keine NEUEN Downs deklariert — verhindert den Restart-Spike (down_count sprang auf 145–285, Notification-Schwall). Vorher schon done Devices bleiben down (keine False-Recoveries).
- Timeout-Basis (v0.0.17): `_last_ok` wird auch beim Übergang gut→schlecht auf `now` gesetzt. Vorher zählte der Timeout ab dem letzten *guten State-Change* — ruhige Geräte (Switch seit Stunden unverändert) waren beim Wechsel nach `unavailable` sofort down (26.08.: ~1000 Entities 2 min unavailable → 160 False-Downs in 65 s). Code-Änderungen an der CC brauchen einen HA-Restart, Entry-Reload reicht nicht.
- Store-Hygiene (v0.0.16): Beim Persistieren werden `last_ok`/`down_state` auf aktuell getrackte Device-IDs gefiltert — keine verwaisten Einträge mehr.
- Exclusion-Liste (`devices_excluded`): **`options` ist massgebend** (`_cfg()` liest options vor data). Stand 26.08.2026: 17 Devices in options (16 Huawei-Optimizer `2102313TTENSP…` + browser_mod), 4 verwaiste IDs entfernt; `data` enthält noch die alte 28er-Liste aus der Erstkonfiguration — irrelevant, nicht pflegen. Pflege über Options-Flow «Einstellungen» (MCP: `ha_set_integration` mit `next_step_id: settings` + ALLE Felder mitschicken). Verwaiste IDs erkennt man über Abgleich mit `core.device_registry`.
- Connection Type: Zigbee/Matter/HomeKit/WLAN/LAN/Solar/Andere via CONNECTION_TYPE_MAP (inkl. smlight; `vitogate_wp` → LAN). Matter/HomeKit statt „Thread", da HA den Transport nicht zuverlässig exponiert. MQTT ist NICHT pauschal Zigbee (seit v0.0.14): nur Devices mit Registry-Identifier `mqtt/zigbee2mqtt*` gelten als Zigbee, generische MQTT-Discovery-Devices (z.B. WiCAN) seit v0.0.15 als „WLAN" (überstimmbar durch spezifischeren Config-Entry am selben Device).
- Timeouts: Critical=15min, Slow=90min (in config entry data gespeichert)
- Power-Gates: Options-Key `power_gates` = Map `{device_id: gate_entity_id}` (Options-Flow-Menü „Power-Gate hinzufügen/entfernen"). Gate-Entity darf `switch`, `input_boolean` oder `binary_sensor` sein (seit v0.0.13; z.B. `binary_sensor.honda_wn7_wach` für das WiCan der Honda WN7). Gate `off` ⇒ `gated=True`, `down=False`, `reason="gated"` (Karte: Gruppe „Stromlos", 🔌). Gate `on` ⇒ normale Logik, Timeout zählt ab Gate-Einschaltzeit (`max(last_ok, gate.last_changed)` — Boot-Fenster). Gate `unavailable` ⇒ normale Down-Logik (toter Shelly maskiert keinen Ausfall). Kein Recovered-Push/Event beim Übergang down→gated. Options-Änderungen lösen via Update-Listener einen Entry-Reload aus (gilt auch für devices_excluded). 7 Gates aktiv: Klima DG, Walldisplay OG, Honda WN7 (`binary_sensor.honda_wn7_wach`), ESP32 Klima Büro (`switch.shelly_1pm_g4_eg_klima_buero`, Shelly 1PM Gen4 16 A @ 10.1.5.160, seit 26.08.2026 — ersetzt den PM Mini + Template-Helper `binary_sensor.buro_klima_zuleitung`), sowie die 3 Prusa Core One (prusa-core-one/-02/-l, alle → `switch.shelly_1pm_g4_eg_buero_prusa_3d` = gemeinsame Büro-Dose; Auto-Off-Automation „Prusa Drucker Auto-Off" schaltet sie ab).

## Sensor-Attribute (Performance)
- `sensor.down_devices.state` = down_count (int), Attribute = `{down_count}` — KEINE Device-Liste
- Volllisten-Zugriff für Lovelace-Karte: WS-Command `device_saver/get_devices` (registriert in `__init__.py`)
- Grund: State >255 chars und Attribute >16 KB würden Recorder-Warning + WebSocket-Overload auslösen (siehe `ha_quirks.md`)

## Dashboard / Karte
- "Grundeinstellungen → Probleme" gruppiert nach Connection Type
- **Karte ist seit v1.0.0 in der Integration gebündelt**: liegt unter `custom_components/device_saver/www/`,
  wird von `async_setup` via `StaticPathConfig` + `add_extra_js_url` unter `/device_saver/device-saver-card.js`
  selbst registriert. **Keine Lovelace-Resource mehr** — der alte Eintrag `/local/device-saver-card.js?v=N` und
  die Datei in `/homeassistant/www/` wurden am 29.08.2026 entfernt. Kein Versions-Bump nötig; `cache_headers=False`.
- Die Karte ist in eine IIFE gewickelt; die Registrierung selbst hängt seit v1.1.2 am `load`-Event
  (`register()` am Dateiende, Guard + `try/catch` darin). Grund: HA installiert mit `app.js` den
  Scoped-Custom-Element-Registry-Polyfill; ein `define()` davor landet nur in der nativen Registry und ist
  für Lovelace unsichtbar → sporadischer „Konfigurationsfehler", den erst ein Reload heilt. Der frühere
  Guard am Modulanfang ist bewusst entfernt — er hätte im Doppelload-Fall `register()` verhindert.
  Details: `ha_quirks.md` → „`define()` vor `app.js` landet in der falschen Registry".
- Manifest braucht deshalb `dependencies: [frontend, http]` und ein `config_entry_only`-`CONFIG_SCHEMA`.
- Seit v1.2.0 liegen **zwei** Karten in `www/`, beide in `LOVELACE_CARDS` — siehe «Settings-Karte».

## Settings-Karte (v1.2.0)
- Zweite Karte `custom:device-saver-settings-card` (`www/device-saver-settings-card.js`), ebenfalls
  gebündelt und via `LOVELACE_CARDS` in `__init__.py` selbst registriert. Konfiguriert alles, was
  auch der Options-Flow kann — **beide schreiben dieselben `options`**, sind also austauschbar.
  Der Options-Flow bleibt bewusst unverändert als Fallback (falls die Karte mal nicht lädt).
- Drei WS-Commands in `__init__.py`, alle **admin-only** (`_require_admin` prüft explizit statt per
  Decorator — so hängt nichts an der Decorator-Reihenfolge) und mit `_OPTIONS_SCHEMA` serverseitig
  validiert:
  - `device_saver/get_config` → Options + Geräte-Katalog + Gates + vorhandene Domains/Platforms
  - `device_saver/set_config` → merged in `entry.options` (gleiche Semantik wie `_save()` im Flow)
  - `device_saver/set_device` → Einzelaktion (ausschliessen / Gate setzen); Read-modify-write läuft
    **serverseitig**, damit zwei offene Tabs sich die Liste nicht gegenseitig überschreiben
- `coordinator.device_catalogue()` liefert auch **ausgeschlossene** Geräte (sonst liesse sich nichts
  wieder einschliessen) und markiert sie per `status`: `ok` · `not_monitored` (würde ohnehin
  übersprungen — ignorierte Integration oder keine Entities) · `missing` (nicht mehr in der
  Registry). Damit fallen verwaiste Exclusion-IDs von selbst auf, statt nur beim Handabgleich mit
  `core.device_registry`.
- Dafür wurde `_build_cache()` aufgeteilt: `_device_entity_map()`, `_battery_devices()`,
  `_candidate_devices()` (ohne Exclusion-Filter), `_connection_type()`. Ergebnis-äquivalent zu vorher.
- **Speichern ist explizit** (Dirty-State + Button): jeder Write löst den Update-Listener und damit
  einen Entry-Reload aus — Auto-Save pro Tastendruck wäre ein Reload pro Zeichen. Nach dem Schreiben
  wartet die Karte `RELOAD_SETTLE_MS` (1.5 s), bevor sie neu liest.
- Nebeneffekt: Beim ersten Speichern werden alle Keys nach `options` geschrieben — die historische
  `data`-Kopie aus der Erstkonfiguration wird damit endgültig irrelevant.
- Die Geräteliste hat für Admins ein **⋮-Zeilenmenü** (nicht überwachen / Power-Gate setzen,
  ändern, entfernen). Nicht-Admins sehen die Spalte gar nicht; `_ws_get_devices` liefert dafür neu
  `gate_entity` mit.

## Sidebar-Panel (v1.3.0)
- `panel.py` registriert ein `panel_custom` mit `www/device-saver-panel.js` (Element
  `device-saver-panel`, zwei Tabs: Geräte + Einstellungen, Settings nur für Admins).
  Manifest braucht dafür `panel_custom` in `dependencies`.
- **Registrierung läuft über `async_at_started`, nicht im Setup.** Grund: Dashboards
  registrieren ihre Panels während des Starts; würde die Integration das Rennen gewinnen,
  verlöre ein gleichnamiges Dashboard seinen Sidebar-Eintrag. Nach dem Start ist eine
  Kollision nur noch *feststellbar* statt verursacht.
- **Nie überschreiben:** `frontend.async_register_built_in_panel` wirft `ValueError`, wenn
  der Pfad belegt ist und `update=False`. `panel.py` fängt das ab und loggt eine Warnung
  mit dem Pfad. Die beiden anderen `ValueError` der Funktion (fehlende `module_url`,
  Config kein Dict) können bei unserem Aufruf nicht auftreten — das `except` ist eindeutig.
  Signaturen am 03.09.2026 gegen `home-assistant/core@dev` verifiziert.
- Optionen `panel` (Default an) und `panel_path` (Default `device-saver`); Änderung wirkt
  über den Entry-Reload sofort, kein Neustart. **Auf dieser Instanz: `device-saver-hub`**,
  weil das eigene Dashboard `device-saver` belegt (und der Sidebar-Organizer-Badge daran hängt).
- Das Panel wartet mit `customElements.whenDefined()`, bevor es eine Karte erzeugt —
  eine `hass`-Zuweisung vor dem Upgrade würde als eigene Property den Setter der Klasse
  verdecken.
- `set route` kann **vor** `set hass` kommen. Der gewünschte Tab wird darum in
  `_wantedTab` geparkt und erst angewandt, wenn feststeht, ob der Nutzer Admin ist —
  sonst filtert `_visibleTabs()` den Settings-Tab weg und der Deep-Link geht verloren.

## Panel-Tabs für Begleiter-Integrationen (v1.4.0)
- `TAB_SPECS` in `device-saver-panel.js` ist eine deklarative Liste; jeder Tab hält
  **normale Lovelace-Kartenkonfigurationen**, gerendert über `window.loadCardHelpers()`
  → `createCardElement()`. Nur so lassen sich eingebaute Karten (die drei `tile` auf dem
  Matter-Tab) neben Custom Cards zeigen. `loadCardHelpers` ist ein etablierter, aber
  **nicht zugesicherter** Frontend-Einstiegspunkt — darum ein Fallback auf
  `createElement` für `custom:`-Typen.
- Erkennung über Entities, nicht über `customElements.get()`: konsistent mit der
  Geräte-Karte (die Matter Saver an `sensor.matter_saver_devices` erkennt) und immun
  gegen den Registry-Polyfill-Fallstrick. `hasPrefix()` toleriert umbenannte Entities.
- Tabs: Matter Saver → Matter Status / Aktivität / Topology / Mesh (Aufbau 1:1 aus dem
  Dashboard des Users übernommen). Herold → Herold + Herold Verwaltung (letzteres admin-only).
- `_syncTabsIfChanged()` wertet die Tab-Liste bei jedem `hass`-Update neu aus, aber nur die
  Signatur — eine Begleiter-Integration, die nach dem Panel fertig lädt, taucht dadurch auf,
  ohne dass bei jedem State-Change neu gerendert wird.
- **Kopplungsrisiko bewusst eingegangen:** device_saver kennt die Kartennamen und Entity-IDs
  von matter-saver und herold fest. Benennt eines der beiden etwas um, bricht der Tab.
  Bestand vorher schon bei den Matter-Spalten der Geräteliste.
- Inhalts-Container tragen `data-pane`, die Tab-Knöpfe `data-tab` — nicht dasselbe
  Attribut für beides, sonst ist der DOM mehrdeutig.

## Karten-Entity-Auflösung (v1.3.0)
- `device-saver-card` ohne `entity:` löste bisher fest auf `sensor.down_devices` auf —
  das ist die **Legacy-ID dieser Instanz**. Neuinstallationen seit v1.1.0 heissen
  `sensor.device_saver_down_devices` und bekamen „Entity not found". `_resolveEntity()`
  probiert jetzt beide und fällt danach auf „irgendein Sensor mit `down_count` +
  `gated_count`" zurück (fängt auch umbenannte Entities).
- Ausserdem setzt die Karte `_initialized` erst, wenn die Entity wirklich da ist. Vorher
  blieb sie nach einem Restart dauerhaft im Fehlerzustand, bis die Seite neu geladen wurde.

## Options-Hygiene (v1.3.1)
- `_prune_options()` in `__init__.py` wirft beim Setup alle Options-Keys weg, die die
  Integration nicht kennt. Anlass: In dieser Instanz lagen die 7 Power-Gate-Zuordnungen
  **zusätzlich flach auf oberster Ebene** der Options (`<device_id>: <entity_id>`),
  dupliziert aus `power_gates` — Altlast eines früheren Schreibpfads. Gelesen wurden sie
  nie (`_cfg()` schlägt nur bekannte Namen nach), aber sie sammelten sich an.
- **`MANAGED_OPTION_KEYS` wird aus `_OPTIONS_SCHEMA` abgeleitet**, nicht ein zweites Mal
  hingeschrieben — sonst driften Schema und Whitelist auseinander und ein neuer Options-Key
  würde beim nächsten Start stillschweigend gelöscht. `getattr(key, "schema", key)` holt den
  Namen aus dem voluptuous-Marker (`Marker.__slots__` enthält `schema`, am 03.09.2026
  gegen voluptuous@master verifiziert).
- Läuft **vor** `entry.add_update_listener()`: sonst löste `async_update_entry()` einen
  Reload des gerade startenden Entries aus. Eine Schleife ist ausgeschlossen, weil der
  zweite Durchlauf nichts mehr zu entfernen findet.
- Nebenwirkung bei einem Downgrade: eine ältere Version kennt neuere Keys nicht und würde
  sie beim Start entfernen. Bewusst in Kauf genommen; das Log nennt jeden entfernten Key.
- Weder Options-Flow noch die Settings-Karte könnten das leisten — beide mergen
  (`{**entry.options, **changes}`) und können darum nur schreiben, nie löschen.

## Tests
- `tools/test_cards.js` — headless jsdom-Smoke-Test beider Karten **und des Panels**
  (92 Checks: Rendering, Zeilenmenü, Gate-Validierung, Dirty-State, Save-Payload,
  Admin-Gating, Entity-Auflösung, Panel-Tabs/Deep-Link).
  `npm install jsdom && node tools/test_cards.js`. Liegt ausserhalb `custom_components/`.
- **jsdom-Fallstrick:** dessen `querySelector("#id")` löst intern über `document.getElementById`
  auf und prüft dann nur die Zugehörigkeit — zwei Karten mit gleichen Element-IDs im selben
  Dokument ergeben `null`. Echte Browser suchen korrekt im Teilbaum. Im Test darum immer nur eine
  Karte gleichzeitig einhängen (`mount()`), kein Kartenfehler.

## Entities (v1.1.0)
- Die drei Entities hängen an einem Service-Device „Device Saver" (`entity.py` → `device_info()`).
- **Diese Instanz behält die alten IDs** `sensor.down_count`, `sensor.down_devices`, `binary_sensor.problem` —
  `entity_registry.async_get_or_create` leitet eine `entity_id` nur beim ersten Auftauchen einer `unique_id` ab
  und ruft für bekannte `async_update_entity()` ohne `new_entity_id`. Verifiziert nach dem Restart 29.08.
  Neuinstallationen bekommen `sensor.device_saver_down_count` etc.
- Nebeneffekt: Die Anzeigenamen tragen jetzt das Device-Präfix („Device Saver Down Count" statt „Down Count").
- Kein Self-Monitoring: der Coordinator überspringt `DeviceEntryType.SERVICE`.

## Sidebar-Badge (Down-Count)
- Roter Kreis mit Down-Count kommt NICHT (mehr) aus `device-saver-card.js` — der hand-injizierte Badge wurde von Sidebar Organizer (accordion_mode) gestrippt. NICHT wieder einbauen.
- Quelle ist Sidebar Organizers native `notification:`-Map in `/homeassistant/www/sidebar-organizer.yaml`, keyed nach `url_path` (`device-saver`) → `sensor.down_count`. Greift nur im SO-Modus „Use YAML File" (sonst localStorage, pro Gerät). Details: `ha_quirks.md` → „Sidebar Organizer (accordion_mode) frisst injizierte Badges".

## GitHub
- Repo: https://github.com/cnc-lasercraft/device-saver
- Branch: main

## Wichtig
- Exclusion-Liste nur in `options` pflegen (data ist historisch)
- Nicht hetzen, jede Änderung verifizieren

## Brand-Icon
- Liegt in `custom_components/device_saver/brand/` (`icon.png` 256 px, `icon@2x.png` 512 px) und wird seit
  HA 2026.3.0 direkt von dort gelesen (Brands Proxy API) — **kein PR an `home-assistant/brands` nötig**,
  wohl aber ein Release, sonst liefert HACS die Datei nie aus.
- Motiv: ein Fragezeichen aus Netzwerk-Knoten; der Punkt ist bernsteinfarben und bewusst unverbunden
  (das Gerät, das vom Netz gefallen ist). Erzeugt von `tools/make_brand_icon.py` — liegt ausserhalb
  `custom_components/`, wird also nicht an Nutzer ausgeliefert. Bilder randlos getrimmt, wie die
  brands-Spezifikation es verlangt. Details: `ha_quirks.md` → „Brand-Icon einer Custom Component".
