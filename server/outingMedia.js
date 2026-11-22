/**
 * Bande-annonce d'une idée de sortie sur un écran Cast (lot 3 de « Sortie à deux v2 ») :
 * le projecteur du salon (même écran que la bûche de la Veillée) ou le Nest Hub de la cuisine.
 * Sur la tablette, la vidéo se joue directement (lecteur YouTube intégré) : rien à faire ici.
 */
import * as castService from './castService.js';
import * as kitchenDisplay from './kitchenDisplay.js';
import * as journal from './journal.js';
import { getYtDlpMuxedUrl } from './ytdlp.js';

const TV = (process.env.VEILLEE_TV || 'Projecteur').trim();
const KITCHEN = () => kitchenDisplay.getView()?.device || 'Cuisine';
const VOLUME = 0.35;

const deviceFor = (target) => castService.findDevice(target === 'kitchen' ? KITCHEN() : TV) || null;

/** Les écrans où envoyer une bande-annonce, et s'ils répondent. */
export const screens = () =>
    ['tv', 'kitchen'].map((id) => {
        const d = deviceFor(id);
        return { id, name: d?.name || (id === 'tv' ? TV : KITCHEN()), online: Boolean(d?.online) };
    });

/**
 * Joue la vidéo YouTube d'une idée (son id dans idea.trailer) sur le projecteur ou le Hub.
 * @param target 'tv' | 'kitchen'
 */
export const castTrailer = async (idea, target) => {
    if (!idea?.trailer) throw new Error('Pas de bande-annonce pour cette idée');
    if (target !== 'tv' && target !== 'kitchen') throw new Error('Écran inconnu');
    const device = deviceFor(target);
    if (!device?.online) throw new Error(`${device?.name || (target === 'tv' ? TV : KITCHEN())} injoignable`);
    const url = await getYtDlpMuxedUrl(idea.trailer);
    await castService.castMedia(device.id, url, 'video/mp4', {
        title: idea.title,
        subtitle: idea.kind === 'cinema' ? 'Bande-annonce' : 'Extrait',
        thumbnail: `https://i.ytimg.com/vi/${idea.trailer}/hqdefault.jpg`,
    });
    castService.setVolume(device.id, VOLUME).catch(() => {});
    journal.log({ kind: 'system', title: `Bande-annonce sur ${device.name} : ${idea.title}` });
    return { ok: true, screen: device.name };
};
