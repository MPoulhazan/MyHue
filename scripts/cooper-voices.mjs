// Enregistre les répliques de Cooper (appel vidéo) avec ElevenLabs et les envoie au serveur.
//
// Voix « Charlie cartoon, son de visio » : voix Charlie (eleven_v3, qui joue les [consignes]),
// puis +4 demi-tons et filtre téléphone (ffmpeg avec rubberband).
//
// Usage :
//   ELEVENLABS_KEY_FILE=chemin/vers/cle FFMPEG=chemin/ffmpeg node scripts/cooper-voices.mjs [http://192.168.0.17:5174] [--force]
// Les fichiers sont nommés d'après le texte (clipName) : changer une réplique dans
// server/cooperCallLogic.js puis relancer ce script n'enregistre que les nouvelles.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';
import { allLines, clipName } from '../server/cooperCallLogic.js';

const VOICE_ID = 'IKne3meq5aSn9XLyUdCD'; // Charlie (voix d'origine ElevenLabs, utilisable avec le compte gratuit)
const PITCH = Math.pow(2, 4 / 12).toFixed(4);
const FILTER = `rubberband=pitch=${PITCH},highpass=f=280,lowpass=f=3600,acompressor=threshold=0.1:ratio=4,volume=1.6`;

// Le jeu d'acteur de chaque réplique ; le texte sans crochets reste celui des sous-titres
const ACTING = {
    "Hey oh. Vous m'avez oublié ou quoi ? J'ai la dalle, là. Filez-moi la croquette… et plus vite que ça.":
        "[sighs] Hey oh. Vous m'avez oublié ou quoi ? [annoyed] J'ai la dalle, là. [bored] Filez-moi la croquette… [shouting] et plus vite que ça !",
    "Allô ? Oui, c'est Cooper. J'appelle de la cuisine. Ma gamelle est vide. Je répète : vide.":
        "Allô ? Oui, c'est Cooper. [bored] J'appelle de la cuisine. Ma gamelle est vide. [annoyed] Je répète : vide.",
    'Bon. Ça fait trente minutes. Je dis rien… mais je note.':
        '[sighs] Bon. Ça fait trente minutes. [sarcastic] Je dis rien… mais je note.',
    "C'est encore moi. Deuxième appel. La prochaine fois, j'appelle mon avocat.":
        "[annoyed] C'est encore moi. Deuxième appel. [serious] La prochaine fois, j'appelle mon avocat.",
    'Re-bonjour. Toujours rien dans la gamelle. Je commence à le prendre personnellement.':
        '[sighs] Re-bonjour. Toujours rien dans la gamelle. [offended] Je commence à le prendre personnellement.',
    "Allô ? Il est neuf heures et demie. Ça pousse, là. Vraiment. On sort, ou quoi ?":
        "Allô ? [bored] Il est neuf heures et demie. Ça pousse, là. [urgent] Vraiment. On sort, ou quoi ?",
    'Bon. La laisse est près de la porte. La porte est fermée. Vous voyez le problème ?':
        '[sighs] Bon. La laisse est près de la porte. La porte est fermée. [sarcastic] Vous voyez le problème ?',
    "C'est encore moi. Toujours pas sorti. Je dis ça, je dis rien… mais ça pousse.":
        "[annoyed] C'est encore moi. Toujours pas sorti. [sighs] Je dis ça, je dis rien… [whining] mais ça pousse.",
    "Allô ? Oui, c'est Cooper. C'est juste un essai. Mais tant que je vous ai… une croquette, peut-être ?":
        "Allô ? Oui, c'est Cooper. C'est juste un essai. [mischievously] Mais tant que je vous ai… une croquette, peut-être ?",
    "Ooooh ! Tu m'entends ? Allô ? Y'a quelqu'un ?":
        "[shouting] Ooooh ! Tu m'entends ? [pause] Allô ? [annoyed] Y'a quelqu'un ?",
    'Ah ben voilà ! Merci, bisous. Je raccroche, je mange.':
        '[excited] Ah ben voilà ! Merci, bisous. [happy] Je raccroche, je mange.',
    "Ah, enfin. Je prends la laisse, j'arrive.":
        "[relieved] Ah, enfin. Je prends la laisse, j'arrive.",
    "D'accord. Dix minutes. Je compte.":
        "[sighs] D'accord. Dix minutes. [serious] Je compte.",
    'Tu raccroches ?! Je rappelle dans vingt minutes.':
        '[shocked] Tu raccroches ?! [annoyed] Je rappelle dans vingt minutes.',
    "Bon. Je n'insiste pas. Mais je m'en souviendrai.":
        "[sighs] Bon. Je n'insiste pas. [sarcastic] Mais je m'en souviendrai.",
    'Bon. Personne. Je rappelle dans vingt minutes.':
        '[sighs] Bon. Personne. [annoyed] Je rappelle dans vingt minutes.',
    'Bon, ben, salut.': '[bored] Bon, ben, salut.',
};
const acting = (line) => {
    if (ACTING[line]) return ACTING[line];
    const meal = /^Allô… Le repas de (\w+), ça vous dit quelque chose \? Non \? Ben moi oui\.$/.exec(line);
    if (meal) return `Allô… [sarcastic] Le repas de ${meal[1]}, ça vous dit quelque chose ? [pause] Non ? [annoyed] Ben moi oui.`;
    console.warn(`⚠️  Pas de jeu prévu, texte brut : ${line}`);
    return line;
};

const server = process.argv.find((a) => a.startsWith('http')) || 'http://192.168.0.17:5174';
const force = process.argv.includes('--force');
const key = readFileSync(process.env.ELEVENLABS_KEY_FILE, 'utf8').trim();
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const work = join(tmpdir(), 'cooper-voices');
mkdirSync(work, { recursive: true });

for (const line of allLines()) {
    const name = clipName(line);
    const out = join(work, name);
    if (!existsSync(out) || force) {
        const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`, {
            method: 'POST',
            headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: acting(line), model_id: 'eleven_v3', language_code: 'fr' }),
        });
        if (!r.ok) throw new Error(`ElevenLabs ${r.status} : ${(await r.text()).slice(0, 200)}`);
        const raw = join(work, `raw-${name}`);
        writeFileSync(raw, Buffer.from(await r.arrayBuffer()));
        execFileSync(ffmpeg, ['-v', 'error', '-y', '-i', raw, '-af', FILTER, '-b:a', '128k', out]);
    }
    const put = await fetch(`${server}/api/cooper/call/voice/${name}`, { method: 'PUT', headers: { 'Content-Type': 'audio/mpeg' }, body: readFileSync(out) });
    console.log(put.ok ? '✅' : `❌ ${put.status}`, name, line);
}
