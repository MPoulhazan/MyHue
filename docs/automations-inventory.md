# Inventaire des automatisations (lot 1, 2026-11-22)

Lecture seule : rien n'a été modifié. But : savoir qui fait quoi, quand, avant de tout centraliser dans MyHue.
Sources : appli Google Home lue sur la tablette murale par ADB (routes `/api/debug/*`, 1.79.2+), API v1 et v2 du pont Hue,
états Home Assistant, règles et code MyHue.

## Ce qui a joué la radio à 08:30 le 22/11

**Routine Google « Mode chill »** : déclencheur horaire **08:30 les fins de semaine**, action « Play the radio » sur Salon,
**sans réglage de volume** (d'où le volume à fond). L'historique Google la note comme « Said "mettre la radio jazz radio" · 08:30 · Salon ».

## Google Home (21 routines)

### À heure fixe — ce sont elles qui agissent toutes seules

| Routine | Quand | Ce qu'elle fait | Recoupe MyHue |
|---|---|---|---|
| **Mode chill** | **08:30 sam-dim** (+ phrase « Mode chill ») | radio sur Salon, volume non réglé | moods musique, briefing |
| Classique lundi mardi jeudi matin | 10:00 lun, mar, jeu | Salon volume 20 %, puis radio | musique planifiée |
| Classique 17h Lundi Mardi | 17:00 lun, mar | Salon volume 20 %, puis radio | musique planifiée |
| Jazz 17h Fin de semaine | 17:00 **mer, jeu, ven, sam** (le nom ment) | Salon volume 20 %, puis radio | musique planifiée |
| La croquette du midi | 12:00 tous les jours (+ phrase) | volume, annonce « Donnez-moi la croquette, merci. », 3ᵉ action | Cooper repas midi (1.31.0) |
| Noël 17h20 | désactivée | 2 actions | Noël MyHue |
| La croquette du soir | désactivée | 3 actions | Cooper repas soir |

### Sur présence (téléphone) — s'exécutent vraiment (historique : Away 15:14 et Home 16:02 le 21/11)

| Routine | Quand | Ce qu'elle fait | Recoupe MyHue |
|---|---|---|---|
| Away | tout le monde parti | éteint Hue play 2, Plante, Plafond… (9 actions, dont 1 lampe disparue) | modèle « Je pars » |
| Home | premier arrivé | rien (0 action) | modèle « Je rentre » |

### À la voix seulement — ne se déclenchent que si quelqu'un parle à Google

| Routine | Phrase | Ce qu'elle fait | Recoupe MyHue |
|---|---|---|---|
| J'ai chaud | « J'ai chaud » | dit « Allume la climatisation » à Google | thermopompe (Google ne la pilote pas : aucun climat exposé dans HA) |
| J'ai froid | « J'ai froid » | dit « Éteins la climatisation » | idem |
| Good morning | « Good morning », « Tell me about my day »… | météo, agenda, tâches, + 2 | briefing 08:30 |
| salut c'est le weekend | « salut c'est le weekend », « Salut ma poule » | allume Plante + Bibliothèque, météo, + 1 | moments / briefing |
| Bonsoir | « Bonsoir » | annonce humoristique, puis radio | — |
| Apéro | « Apéro » | scène Salon « Apéro », annonce humoristique, puis média | scènes Hue |
| On boit un coup où on s'encule | la phrase | annonce humoristique | — |
| Au lit | « Au lit » | éteint toutes les lumières, éteint la musique | « Dodo » |
| C'est pas Versailles ici | la phrase | éteint toutes les lumières | lumières |
| éteint tout | « éteint tout », « je me barre » | éteint Plante, Bibliothèque, la musique, + 1 | lumières |
| Lumos | « Lumos » | allume les lumières | lumières |
| Je suis rentré | « Je suis rentré » | annonce de bienvenue, puis musique | « Je rentre » |
| I'm home | « I'm home », « I'm back » | musique | « Je rentre » |
| Commuting home | « Let's go home » | trajet, diffusion « I'm on my way home », média | Déplacements |
| Leaving home | « I'm leaving »… | rien (0 action) | — |
| Bedtime | désactivée | — | — |

## Pont Hue (API v1 + v2)

| Routine de l'appli Hue | Déclencheur | Ce qu'elle fait | Recoupe MyHue |
|---|---|---|---|
| **Leaving home** (active) | géorepérage du **Pixel 7** : départ | éteint toutes les lampes | modèle « Je pars », Away Google |
| **Coming home** (active) | géorepérage du Pixel 7 : arrivée, **la nuit seulement** | recette d'éclairage sur toute la maison | modèle « Je rentre », lampe d'entrée |
| Hue dimmer switch salon | boutons | cycle de scènes, variation, appui long = tout éteindre | — |
| Hue dimmer switch dinning | boutons | cycle de scènes, variation | — |
| Règles v1 15-18, Geofence 5/7/8 | anciens téléphones Huawei | — | mortes depuis 2019 |

Pas de minuterie, de réveil ni de coucher programmés dans l'appli Hue.

## Home Assistant

`automation.*` : aucune. `script.*` : aucun. Pas d'entité `climate` (la thermopompe n'est visible que dans MyHue).

## MyHue

- Règles capteurs (12, 11 actives) : température basse, porte terrasse (chauffage coupé, oubliée, orage), porte d'entrée oubliée,
  fuite d'eau, fumée, piles, capteurs muets. « Ouverture la nuit » désactivée.
- À heure fixe, dans le code : briefing 08:30 lun-ven (suit l'alarme du téléphone), Nest Hub cuisine re-casté 06:30–23:00,
  Ma journée (mails ~06:45), Cooper midi 12:00 / soir 18:00, alertes BIXI et ville du matin, poubelles la veille au soir,
  lampe d'entrée sur porte/mouvement, Noël (24 nov–31 déc). Thermostat programmé : désactivé.
- Thermopompe : aucune automatisation ne la met en froid. Le 22/11 à 07:01, c'est un appui sur « Froid » dans l'interface
  (corrigé en 1.79.1 : double appui quand il fait froid dehors).

## Lot 2 — décisions (validées le 2026-11-22)

Choix de l'utilisateur : musique « reprendre sauf Mode chill », présence « MyHue seul », voix « garder chez Google ».
Rien n'est supprimé ni désactivé avant le lot 5, et une routine ne part qu'une fois son remplaçant MyHue en service.

| Système | Routine | Décision | Remplaçant / remarque |
|---|---|---|---|
| Google | Mode chill (08:30 week-end) | **Supprimer** | rien ; la phrase « Mode chill » part avec |
| Google | Classique lundi mardi jeudi matin | **Reprendre dans MyHue** | 10:00 lun, mar, jeu · Salon · 20 % · radio Classique · seulement si quelqu'un est là |
| Google | Classique 17h Lundi Mardi | **Reprendre dans MyHue** | 17:00 lun, mar · Salon · 20 % · radio Classique · si quelqu'un est là |
| Google | Jazz 17h Fin de semaine | **Reprendre dans MyHue** | 17:00 mer, jeu, ven, sam · Salon · 20 % · radio Jazz doux · si quelqu'un est là |
| Google | La croquette du midi | **Supprimer** | doublon du rappel Cooper MyHue de 12:00 |
| Google | La croquette du soir (désactivée) | **Supprimer** | Cooper MyHue 18:00 |
| Google | Noël 17h20 (désactivée) | **Supprimer** | Noël MyHue |
| Google | Bedtime (désactivée) | **Supprimer** | — |
| Google | Away | **Supprimer** | modèle MyHue « Je pars » (présence HA Companion) |
| Google | Home | **Supprimer** | modèle MyHue « Je rentre » |
| Google | Leaving home (vocale, 0 action) | **Supprimer** | vide |
| Google | J'ai chaud / J'ai froid | **Supprimer** | sans effet ; la thermopompe se pilote par Jean-Claude ou MyHue |
| Google | Apéro, Au lit, Bonsoir, C'est pas Versailles ici, éteint tout, Lumos, On boit un coup…, salut c'est le weekend, Je suis rentré, I'm home, Good morning, Commuting home | **Garder chez Google** | commandes « Ok Google » sur les enceintes, que MyHue n'entend pas |
| Hue | Leaving home (Pixel 7) | **Supprimer** | « Je pars » MyHue |
| Hue | Coming home (Pixel 7, la nuit) | **Supprimer** | « Je rentre » MyHue (salon en blanc chaud la nuit) |
| Hue | Interrupteurs salon et salle à manger | **Garder** | boutons physiques, pas des automatisations |
| Hue | Règles v1 15-18, Geofence 5/7/8 | **Supprimer** (ménage) | mortes depuis 2019, sans effet |
| HA | — | — | rien à faire |
| MyHue | Règles capteurs et tâches du code | **Garder** | déjà au centre |

À construire au lot 3 : déclencheur horaire (jours + heure) et action « musique sur une enceinte à un volume donné »,
avec condition « quelqu'un est à la maison » ; activer « Je pars » et « Je rentre ».
Ordre du lot 5 : d'abord Mode chill (aucun remplaçant nécessaire), puis chaque routine dès que son remplaçant a tourné une fois.

## Lot 3 — ce que MyHue sait faire maintenant (1.80.0)

- **Déclencheur horaire** `{ type: 'time', at: 'HH:MM' | 'sunrise' | 'sunset', offsetMinutes, days: [0..6] }` (0 = dimanche),
  vérifié toutes les 30 s, une seule fois par jour, rattrapage de 10 min après un redémarrage (`server/scheduleLogic.js`).
- **Condition** `someone_home` : quelqu'un est à la maison d'après HA Companion (présence inconnue = on joue).
- **Action musique** `music_play` avec `volume` : réglé avant le son. Lancée par un automatisme, elle ne dépasse jamais 30 %
  avant 11 h et après 22 h (20 % si aucun volume n'est donné).
- **Modèle « Musique programmée »** (`scheduled_music`) : POST /api/automations `{ template, params: { name, at, days, deviceName, what, id, volume } }`.
- Essai réel le 22/11 : déclenché à 12:56:13, une seule fois, puis supprimé.

Créés sur le Pi :

| Automatisme | État | Pourquoi |
|---|---|---|
| Classique du matin (10:00 lun, mar, jeu, Salon 20 %) | désactivé | s'allume au lot 5, en même temps que la routine Google s'éteint |
| Classique de 17 h (lun, mar) | désactivé | idem |
| Jazz de 17 h (mer → sam) | désactivé | idem |
| Je pars (moment départ + Telegram) | actif | double pour l'instant les routines Hue/Google de départ, sans conflit |
| Je rentre (salon blanc chaud la nuit) | actif | idem pour l'arrivée |

À régler avant le lot 5 : **l'enceinte Salon est injoignable pour MyHue et pour HA** (adresse 192.168.0.117) alors que Google
l'utilise ; sans elle, les trois musiques ne joueront pas.

## Doublons repérés au lot 1

1. **Musique à heure fixe** (Mode chill, Classique ×2, Jazz) : les quatre sont chez Google, sans plafond de volume pour Mode chill.
2. **Départ / arrivée** : trois systèmes pour le même événement : Google Away/Home, Hue Leaving/Coming home, modèles MyHue.
3. **Cooper midi** : annonce Google à 12:00 et rappel MyHue à 12:00.
4. **Matin** : Good morning / salut c'est le weekend (Google) contre briefing MyHue.
5. **J'ai chaud / J'ai froid** : sans effet aujourd'hui (Google ne voit pas la thermopompe).
