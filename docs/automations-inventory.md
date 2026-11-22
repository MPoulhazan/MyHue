# Inventaire des automatisations (lot 1, 2026-11-22)

Lecture seule : rien n'a été modifié. But : savoir qui fait quoi, quand, avant de tout centraliser dans MyHue.

## Google Home (home.google.com, 21 routines)

Le site web ne montre que le nom et le nombre de déclencheurs et d'actions. Le détail
(heure, enceinte, station) n'est lisible que dans l'appli : « Ouvrir l'application Google Home pour modifier ».

| Routine | Type | État | Décl. / actions | Ce que le nom laisse deviner | Recoupe MyHue ? |
|---|---|---|---|---|---|
| Classique 17h Lundi Mardi | maison | active | 1 / 2 | radio classique à 17 h lun-mar | musique planifiée |
| Classique lundi mardi jeudi matin | maison | active | 1 / 2 | radio classique le matin | musique planifiée, briefing |
| J'ai chaud | maison | active | 1 / 1 | phrase vocale → clim ? | thermopompe |
| J'ai froid | maison | active | 1 / 1 | phrase vocale → chauffage ? | thermopompe |
| Jazz 17h Fin de semaine | maison | active | 1 / 2 | radio jazz à 17 h sam-dim | musique planifiée |
| Noël 17h20 | maison | désactivée | 0 / 2 | musique de Noël | Noël MyHue (1.74–1.77) |
| Home | maison | active | 2 / 0 | présence, ne fait rien | présence HA |
| Away | maison | active | 2 / 9 | départ de tous : 9 actions | modèle « Je pars » |
| Apéro | perso | active | 1 / 3 | phrase vocale, ambiance | scènes Hue |
| Au lit | perso | active | 1 / 2 | phrase vocale | « Dodo » |
| Bonjour | perso | active | 1 / 5 | routine du matin (météo, agenda, musique ?) | briefing 08:30 |
| Bonsoir | perso | active | 1 / 2 | phrase vocale | — |
| C'est pas Versailles ici | perso | active | 1 / 1 | phrase vocale → tout éteindre ? | lumières |
| Heure du coucher | perso | désactivée | 0 / 2 | — | — |
| Je quitte la maison | perso | active | 1 / 0 | ne fait rien | — |
| Je suis de retour | perso | active | 1 / 1 | — | modèle « Je rentre » |
| Je suis rentré | perso | active | 1 / 2 | — | modèle « Je rentre » |
| La croquette du midi | perso | active | 2 / 3 | rappel repas de Cooper | Cooper (1.31.0) |
| La croquette du soir | perso | désactivée | 0 / 3 | rappel repas de Cooper | Cooper (1.31.0) |
| Lumos | perso | active | 1 / 1 | phrase vocale → lumière | lumières |
| Mode chill | perso | active | 2 / 1 | — | moods musique |
| On boit un coup où on s'encule | perso | active | 1 / 1 | phrase vocale | — |
| salut c'est le weekend | perso | active | 1 / 4 | weekend, sans doute musique | **probable radio de 08:30 ce dimanche** |
| Trajet travail-domicile | perso | active | 1 / 3 | trajet, lumières/musique | Déplacements |
| éteint tout | perso | active | 1 / 4 | tout éteindre | lumières |

Recoupements à trancher au lot 2 : musique planifiée (Classique, Jazz, weekend, Bonjour) contre briefing et moods
MyHue, chaud/froid contre la thermopompe, croquettes contre Cooper, Home/Away contre présence HA.

## Pont Hue (lu via /api/hue, API v1)

| Élément | Ce qu'il fait | État réel |
|---|---|---|
| Schedules (minuteries v1) | aucun | — |
| Règles 15-18 + resourcelinks « Geofence 5/7/8 » | géorepérage de l'appli Hue → capteur « présent » 4 | morts : anciens téléphones Huawei, dernières données en 2019 |
| Resourcelink « Home and Away 4 » | comportement « arrivée/départ » de l'appli Hue, scène « Lumineux » sur tout, selon le jour/la nuit | probablement inerte (géorepérage mort), à confirmer |
| Interrupteurs « dimmer salon » et « dimmer dinning » | boutons gérés par le pont | utilisés (salon ce matin 07:26) |

Non lisible en API v1 : les routines récentes de l'appli Hue (réveil, coucher, minuteurs, réglages des interrupteurs).
Elles vivent en API v2 (`behavior_instance`), que le proxy MyHue ne relaie pas.

## Home Assistant

`automation.*` : aucune. `script.*` : aucun. Tout ce qui tourne dans HA passe par MyHue.

## MyHue (pour mémoire)

- Règles capteurs (12, 11 actives) : température basse, porte terrasse (chauffage coupé, oubliée, orage), porte d'entrée oubliée,
  fuite d'eau, fumée, piles, capteurs muets. « Ouverture la nuit » désactivée.
- À heure fixe, dans le code : briefing 08:30 lun-ven (suit l'alarme du téléphone), Nest Hub cuisine re-casté 06:30–23:00,
  Ma journée (mails ~06:45), Cooper midi 12:00 / soir 18:00, alertes BIXI et ville du matin, poubelles la veille au soir,
  lampe d'entrée sur porte/mouvement, Noël (24 nov–31 déc). Thermostat programmé : désactivé.
- Thermopompe : aucune automatisation ne la met en froid. Le 22/11 à 07:01, c'est un appui sur « Froid » dans l'interface
  (corrigé en 1.79.1 : double appui quand il fait froid dehors).
