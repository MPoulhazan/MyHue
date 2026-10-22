# Add-on Home Assistant MyHue

MyHue tourne en add-on local sur la machine Home Assistant (24h/24, sans le PC).
À chaque build, le Dockerfile récupère le code depuis GitHub (`master`).

## Installation

1. Dans HA, installer les add-ons **Samba share**, **Mosquitto broker** et **Zigbee2MQTT**.
2. Depuis l'Explorateur Windows, ouvrir `\\homeassistant.local\addons` et copier le dossier
   `ha-addon/myhue` dedans (donc `addons\myhue\config.yaml`).
3. HA → Paramètres → Modules complémentaires → Boutique → ⋮ → **Rechercher des mises à jour**.
   MyHue apparaît dans la section **Local add-ons** → Installer (le build prend quelques minutes).
4. Onglet **Configuration** : renseigner les clés (Groq, Hue, Telegram, Broadlink, Cast, YouTube),
   reprises du `.env` du PC.
5. Démarrer, puis ouvrir `http://homeassistant.local:5174`.

Automatique, rien à configurer :
- l'accès à l'API HA (`SUPERVISOR_TOKEN`) ;
- les identifiants MQTT de Mosquitto (Zigbee2MQTT en mode distant) ;
- les données (`rules.json`, `sensors.json`, `heating-state.json`) dans `/data` de l'add-on,
  incluses dans les sauvegardes HA.

## Mise à jour

`git push` sur `master`, puis dans HA : add-on MyHue → **Reconstruire**.
Si `config.yaml` / `Dockerfile` / `run.mjs` changent, recopier le dossier `myhue` via Samba
et augmenter `version` dans `config.yaml`.
