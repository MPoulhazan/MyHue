// ── Les 24 cases du calendrier de l'Avent ────────────────────────────────────
//
// kind : song (une chanson jouée sur l'enceinte), mission (à faire dans la journée),
// fact (une anecdote), cooper (une photo de Cooper), outing (une sortie à Montréal).
// query : la recherche YouTube de la chanson. Les sorties ne promettent pas d'horaires :
// elles changent chaque année.

export const ADVENT_DAYS = [
    { n: 1, kind: 'song', title: 'Petit Papa Noël', body: 'Tino Rossi, 1946. Le premier chant de la saison, c’est lui.', query: 'Tino Rossi Petit Papa Noël' },
    { n: 2, kind: 'mission', title: 'Chocolat chaud ce soir', body: 'Avec des guimauves. Et une croquette en bonus pour Cooper.' },
    { n: 3, kind: 'fact', title: 'Le premier sapin du Canada', body: 'Il a été décoré à Sorel en 1781, par la baronne von Riedesel, qui venait d’Allemagne.' },
    { n: 4, kind: 'outing', title: 'Les vitrines du centre-ville', body: 'La vitrine de Noël d’Ogilvy, rue Sainte-Catherine, est une tradition montréalaise depuis les années 1940.' },
    { n: 5, kind: 'song', title: 'Vive le vent', body: 'L’adaptation française de Jingle Bells, signée Francis Blanche.', query: 'Vive le vent chanson de Noël' },
    { n: 6, kind: 'mission', title: 'Sortir les décorations', body: 'Le sapin, les guirlandes, l’étoile. Cooper inspecte les boîtes.' },
    { n: 7, kind: 'cooper', title: 'Cooper, version hiver', body: 'Il est prêt pour la neige. À peu près.', photo: '/cooper-poil.webp' },
    { n: 8, kind: 'fact', title: 'H0H 0H0', body: 'C’est le code postal du Père Noël. Postes Canada répond aux lettres des enfants depuis les années 1980.' },
    { n: 9, kind: 'song', title: 'Il est né, le divin enfant', body: 'Un vieil air populaire français, publié en 1862.', query: 'Il est né le divin enfant' },
    { n: 10, kind: 'mission', title: 'Écrire une carte', body: 'Une vraie, sur papier, à quelqu’un qui ne s’y attend pas.' },
    { n: 11, kind: 'outing', title: 'Patiner au Lac aux Castors', body: 'Sur le mont Royal, dès que la glace est prête. L’état des patinoires est sur le site de la Ville.' },
    { n: 12, kind: 'song', title: 'Le petit renne au nez rouge', body: 'Chanson américaine de 1949, devenue un classique en français.', query: 'Le petit renne au nez rouge chanson' },
    { n: 13, kind: 'fact', title: 'Douce nuit', body: 'Composée en 1818 dans un village d’Autriche, Oberndorf, par Franz Gruber et Joseph Mohr.' },
    { n: 14, kind: 'mission', title: 'Promenade aux lumières', body: 'Le tour du quartier avec Cooper pour voir les maisons décorées.' },
    { n: 15, kind: 'song', title: 'Christmas Time Is Here', body: 'Vince Guaraldi, 1965. Le jazz de Charlie Brown, parfait pour le souper.', query: 'Vince Guaraldi Christmas Time Is Here' },
    { n: 16, kind: 'fact', title: 'La guignolée', body: 'Autrefois, on passait de porte en porte au jour de l’An pour les plus pauvres. Le mot est resté pour les collectes de nourriture.' },
    { n: 17, kind: 'outing', title: 'Luminothérapie', body: 'Les installations lumineuses du Quartier des spectacles, gratuites, à voir le soir.' },
    { n: 18, kind: 'song', title: 'Mon beau sapin', body: 'O Tannenbaum en allemand, chanté depuis le XIXe siècle.', query: 'Mon beau sapin chanson de Noël' },
    { n: 19, kind: 'mission', title: 'Une soirée film de Noël', body: 'On choisit à deux, et le bouton Veillée fait le reste.' },
    { n: 20, kind: 'cooper', title: 'Cooper fait dodo', body: 'Il garde ses forces pour le réveillon.', photo: '/cooper-dodo.webp' },
    { n: 21, kind: 'song', title: 'Minuit, chrétiens', body: 'Adolphe Adam, 1847. Le grand moment de la messe de minuit.', query: 'Minuit chrétiens' },
    { n: 22, kind: 'fact', title: 'Le réveillon québécois', body: 'Il commençait après la messe de minuit : tourtière, ragoût de pattes et beignes, jusqu’au matin.' },
    { n: 23, kind: 'mission', title: 'Emballer les cadeaux', body: 'Dernière ligne droite. Le ruban adhésif est dans le tiroir, normalement.' },
    { n: 24, kind: 'song', title: 'Joyeux réveillon', body: 'C’est ce soir. All I Want for Christmas Is You, pour lancer la fête.', query: 'Mariah Carey All I Want for Christmas Is You' },
];

export const KIND_LABEL = { song: 'Chanson', mission: 'Mission', fact: 'Le saviez-vous', cooper: 'Cooper', outing: 'Sortie' };
