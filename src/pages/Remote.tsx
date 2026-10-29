import { useState } from 'react';
import axios from 'axios';
import { useHomeData } from '../hooks/useHome';
import { hhmm } from '../components/home/cards';
import './Dashboard.css';
import './Remote.css';

interface LearnResult {
    ok: boolean;
    text: string;
}

const MODE_NAMES: Record<string, string> = { heat: 'chaud', cool: 'froid', dry: 'sec', fan: 'ventilation', auto: 'auto' };

/** Télécommande infrarouge : capter une trame de la vraie télécommande et la comparer à celle de MyHue. */
export function Remote() {
    const home = useHomeData();
    const h = home.heating;
    const [learning, setLearning] = useState(false);
    const [result, setResult] = useState<LearnResult | null>(null);

    const learn = async () => {
        setLearning(true);
        setResult(null);
        try {
            const { data } = await axios.post('/api/heating/learn', {}, { timeout: 30000 });
            if (!data.decoded) {
                setResult({ ok: false, text: `Signal reçu mais pas reconnu comme Mitsubishi (${data.frames.length} trame${data.frames.length > 1 ? 's' : ''}). Il est enregistré pour analyse.` });
            } else {
                const d = data.decoded;
                const what = `${d.power ? 'marche' : 'arrêt'}, ${MODE_NAMES[d.mode] ?? d.mode}, ${d.temperature}°, ventilation ${d.fanSpeed}`;
                setResult(data.diff.length === 0
                    ? { ok: true, text: `Télécommande captée (${what}) : MyHue envoie exactement la même trame.` }
                    : { ok: false, text: `Télécommande captée (${what}) : écart sur les octets ${data.diff.join(', ')}. Capture enregistrée pour corriger l'encodeur.` });
            }
        } catch (err) {
            setResult({ ok: false, text: axios.isAxiosError(err) ? err.response?.data?.error || err.message : 'Échec de la capture' });
        } finally {
            setLearning(false);
        }
    };

    return (
        <div className="home">
            <header className="home-top">
                <div className="home-hello"><h1>Télécommande infrarouge</h1></div>
            </header>

            <section className="card remote" aria-label="Émetteur infrarouge">
                <div className="card-foot">
                    <div><span>Émetteur Broadlink</span>
                        <span className={!h ? 'muted' : h.connected ? '' : 'warn'}>{h ? (h.connected ? 'connecté' : 'non connecté') : '…'}</span></div>
                    <div><span>Pompe à chaleur</span><span>Mitsubishi</span></div>
                    <div><span>Dernière commande</span><span>{h?.lastUpdated ? hhmm(new Date(h.lastUpdated)) : 'aucune'}</span></div>
                </div>
            </section>

            <section className="card remote" aria-label="Vérifier la télécommande">
                <h2 className="card-title">Vérifier les trames</h2>
                <p className="remote-text">
                    Si la clim ne réagit pas comme prévu, capte un appui de la vraie télécommande : MyHue la compare à ce qu'il envoie
                    et garde la capture pour corriger l'encodeur.
                </p>
                <button type="button" className="pill-btn light" onClick={learn} disabled={learning || !h?.connected}>
                    {learning ? 'Vise le Broadlink et appuie sur la télécommande…' : 'Capter la télécommande'}
                </button>
                {result && <p className={`remote-result ${result.ok ? 'ok' : 'warn'}`} role="status">{result.text}</p>}
            </section>
        </div>
    );
}
