# Guide d'utilisation Google Cast

Ce guide t'explique comment utiliser les fonctionnalités Google Cast de MyHue pour contrôler tes appareils Google Home, Chromecast et Nest.

## Configuration initiale

### Découverte automatique (recommandé)

Les appareils Google Cast sur ton réseau sont découverts automatiquement. Aucune configuration n'est nécessaire !

Lance simplement le serveur agent :

```bash
npm run agent
```

Les appareils seront découverts automatiquement et listés dans les logs :

```
📱 Found Google Cast device: Living Room (192.168.0.100)
📱 Found Google Cast device: Bedroom Nest (192.168.0.101)
```

### Découverte manuelle (si problème)

Si l'auto-découverte ne fonctionne pas, tu peux utiliser le script de découverte :

```bash
npm run discover-cast
```

Ce script va chercher tous les appareils Cast sur ton réseau et te donner les commandes exactes à ajouter dans ton `.env`.

### Configuration manuelle

Si la découverte ne fonctionne toujours pas (problème de pare-feu Windows), tu peux configurer manuellement tes appareils dans `.env` :

```env
CAST_DEVICES=Salon:192.168.0.100,Chambre:192.168.0.101
```

Format : `Nom:IP,Nom2:IP2,...`

## Commandes disponibles

### 1. Caster du contenu multimédia

**Caster une vidéo YouTube :**
```
"Lance la vidéo youtube.com/watch?v=dQw4w9WgXcQ sur la Google Home"
"Play YouTube video on Chromecast"
"Joue cette vidéo YouTube sur la Nest"
```

L'IA extraira automatiquement l'ID de la vidéo YouTube et la lancera sur l'appareil.

**Caster un média personnalisé :**
```
"Cast this MP4 video to Living Room: https://example.com/video.mp4"
"Joue ce fichier audio sur la Nest Hub"
```

### 2. Contrôler la lecture

**Play/Pause/Stop :**
```
"Mets pause sur la Google Home"
"Reprends la lecture sur le Chromecast"
"Arrête la vidéo sur la Nest"
"Pause the video on Living Room"
"Stop playback on Bedroom"
```

### 3. Régler le volume

**Changer le volume :**
```
"Mets le volume à 50% sur la Google Home"
"Monte le son à 80% sur le Chromecast"
"Baisse le volume à 20%"
"Set volume to 0.5 on Living Room"  # (0 = muet, 1 = max)
```

## Exemples de scénarios

### Scénario 1 : Soirée film

```
User: "Lance une vidéo YouTube relaxante sur le Chromecast et éteins toutes les lampes sauf celle du salon à 20%"
```

L'IA va :
1. Trouver l'appareil Cast nommé "Chromecast"
2. Lancer une vidéo YouTube
3. Éteindre toutes les lampes Hue
4. Allumer la lampe du salon à 20%

### Scénario 2 : Musique d'ambiance

```
User: "Joue de la musique sur la Nest et crée une ambiance chaude"
```

L'IA va :
1. Lancer du contenu audio sur la Nest
2. Régler les lampes Hue avec des couleurs chaudes

### Scénario 3 : Via Telegram

Tu peux aussi contrôler via Telegram :

```
/start
"Lance une vidéo sur la Google Home du salon"
```

## Formats de médias supportés

| Type | Format | Exemple |
|------|--------|---------|
| YouTube | URL YouTube | `youtube.com/watch?v=VIDEO_ID` |
| Vidéo | MP4, WebM | `https://example.com/video.mp4` |
| Audio | MP3, AAC, FLAC | `https://example.com/music.mp3` |
| Image | JPEG, PNG | `https://example.com/photo.jpg` |

## Résolution de problèmes

### Aucun appareil découvert

1. **Vérifie que les appareils sont allumés** et sur le même réseau WiFi
2. **Désactive temporairement le pare-feu Windows** pour tester
3. **Utilise la configuration manuelle** dans `.env`

```bash
# Trouve les IP de tes appareils dans l'application Google Home
# Puis ajoute dans .env :
CAST_DEVICES=Nom Appareil:192.168.0.XXX
```

### Erreur "Device not found"

L'IA n'a pas trouvé l'appareil avec le nom que tu as donné. Vérifie :

1. Le nom exact de l'appareil dans l'app Google Home
2. Utilise `/status` sur Telegram ou vérifie les logs du serveur agent pour voir les appareils disponibles
3. L'IA fait une recherche partielle, donc "salon" trouvera "Google Home Salon"

### Erreur "Connection timeout"

1. Vérifie que l'appareil n'est pas en veille
2. Redémarre l'appareil Google Cast
3. Vérifie que le port 8009 n'est pas bloqué par ton pare-feu

### Le cast fonctionne mais s'arrête immédiatement

Certains contenus nécessitent des métadonnées spécifiques. L'IA essaiera de les deviner, mais tu peux être plus explicite :

```
"Cast this MP4 video with title 'My Video' to Living Room: https://example.com/video.mp4"
```

## Commandes avancées

### Vérifier les appareils disponibles

Dans le code ou via un endpoint API :

```bash
curl http://localhost:5174/api/agent/status
```

Retourne :
```json
{
  "ok": true,
  "hueConfigured": true,
  "groqConfigured": true,
  "model": "llama-3.3-70b-versatile",
  "castDevices": 2,
  "devices": [
    {
      "name": "Living Room",
      "host": "192.168.0.100",
      "port": 8009,
      "id": "192.168.0.100"
    },
    {
      "name": "Bedroom Nest",
      "host": "192.168.0.101",
      "port": 8009,
      "id": "192.168.0.101"
    }
  ]
}
```

## Limitations connues

1. **YouTube** : Les vidéos YouTube sont lancées via URL, certaines peuvent ne pas fonctionner si elles ne sont pas publiques
2. **DRM** : Les contenus protégés par DRM (Netflix, Disney+, etc.) ne peuvent pas être castés directement
3. **Formats** : Seuls les formats supportés nativement par Google Cast fonctionnent
4. **Contrôle limité** : Pas de contrôle de la progression (seek), seulement play/pause/stop

## Prochaines améliorations

- [ ] Support de Spotify
- [ ] Queue de lecture
- [ ] Contrôle de la progression (seek)
- [ ] Playlists YouTube
- [ ] Groupes d'appareils (multi-room)

## Questions ?

Ouvre une issue sur GitHub ou consulte la documentation officielle de Google Cast :
- https://developers.google.com/cast

---

Profite bien de ton installation MyHue avec Google Cast ! 🎬✨
