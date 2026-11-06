# Politique de confidentialité de MyHue

*Dernière mise à jour : 6 novembre 2026*

MyHue est une application domotique auto-hébergée. Elle tourne sur le serveur de la maison (un module Home Assistant) et ne sert que le foyer qui l'installe. Nous n'exploitons aucun serveur central.

## Données Google et YouTube

Quand vous connectez votre compte YouTube, MyHue demande un seul accès, **en lecture seule** (`youtube.readonly`). Il sert uniquement à :

- afficher la liste de vos playlists et leur contenu sur l'écran de la maison ;
- lancer la lecture de ces titres sur vos enceintes.

MyHue ne publie rien, ne modifie rien et ne supprime rien sur votre compte.

## Ce qui est conservé, et où

- Les jetons d'accès Google sont enregistrés **uniquement sur votre propre serveur**, dans le dossier de données du module. Ils ne sont envoyés à personne d'autre que Google.
- Les informations de playlists sont lues au moment où vous les affichez. Seuls les liens de playlists que vous ajoutez vous-même sont gardés, sur ce même serveur.
- Aucune donnée n'est vendue, partagée, utilisée pour de la publicité ou pour entraîner des modèles.

L'usage des informations reçues des API Google respecte la [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), y compris ses exigences d'usage limité (*Limited Use*).

## Retirer l'accès

- Dans MyHue : page Musique → « Déconnecter le compte YouTube ». Les jetons sont alors effacés du serveur.
- Côté Google : [myaccount.google.com/permissions](https://myaccount.google.com/permissions) → MyHue → Supprimer l'accès.

## Questions

Pour toute question, ouvrez une *issue* sur le dépôt GitHub du projet.
