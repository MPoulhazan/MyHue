import { useEffect, useMemo, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { agentApi, type AgentMessage } from '../services/agentApi';
import './Agent.css';

export const Agent = () => {
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState<AgentMessage[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<{
        ok: boolean;
        hueConfigured: boolean;
        groqConfigured?: boolean;
        model: string;
    } | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        agentApi
            .getStatus()
            .then(setStatus)
            .catch(() =>
                setStatus({ ok: false, hueConfigured: false, model: '' }),
            );
    }, []);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, loading]);

    const canSend = useMemo(
        () => input.trim().length > 0 && !loading,
        [input, loading],
    );

    const pushMessage = (role: AgentMessage['role'], content: string) => {
        setMessages((prev) => [...prev, { role, content }]);
    };

    const handleSend = async () => {
        if (!canSend) {
            return;
        }

        const message = input.trim();
        setInput('');
        setError(null);
        setLoading(true);
        pushMessage('user', message);

        try {
            const response = await agentApi.sendMessage(message, messages);
            if (response.error) {
                setError(response.error);
            } else {
                pushMessage('assistant', response.message);
            }
        } catch (err: any) {
            setError(
                err?.response?.data?.error || err?.message || 'Erreur inconnue',
            );
        } finally {
            setLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleExampleClick = (example: string) => {
        setInput(example);
    };

    return (
        <div className="agent-container">
            <header className="agent-header">
                <div>
                    <h1>Assistant IA</h1>
                    <p className="subtitle">
                        Observations, recommandations et actions sur vos lampes.
                    </p>
                </div>
                <div className="agent-status">
                    <span
                        className={`status-dot ${
                            status?.ok
                                ? status?.groqConfigured === false
                                    ? 'error'
                                    : status?.hueConfigured
                                      ? 'ok'
                                      : 'warning'
                                : 'error'
                        }`}
                    />
                    <span>
                        {status?.ok
                            ? status?.groqConfigured === false
                                ? 'Groq non configuré'
                                : status?.hueConfigured
                                  ? `Agent prêt · ${status?.model}`
                                  : 'Agent prêt · Configuration Hue manquante'
                            : 'Agent hors-ligne'}
                    </span>
                </div>
            </header>

            <section className="agent-chat glass">
                <div className="chat-messages">
                    {messages.length === 0 && !loading && (
                        <div className="chat-empty">
                            <p>💬 Exemples de commandes</p>
                            <ul>
                                <li onClick={() => handleExampleClick("Éteins toutes les lampes")}>
                                    "Éteins toutes les lampes"
                                </li>
                                <li onClick={() => handleExampleClick("Crée une ambiance chaude dans le salon")}>
                                    "Crée une ambiance chaude dans le salon"
                                </li>
                                <li onClick={() => handleExampleClick("Quelles lampes sont allumées ?")}>
                                    "Quelles lampes sont allumées ?"
                                </li>
                            </ul>
                        </div>
                    )}

                    {messages.map((message, index) => (
                        <motion.div
                            key={`${message.role}-${index}`}
                            className={`chat-bubble ${message.role}`}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.3 }}
                        >
                            <p>{message.content}</p>
                        </motion.div>
                    ))}

                    {loading && (
                        <div className="typing-indicator">
                            <div className="typing-dot"></div>
                            <div className="typing-dot"></div>
                            <div className="typing-dot"></div>
                        </div>
                    )}

                    <div ref={messagesEndRef} />
                </div>

                <div className="chat-input-container">
                    <div className="chat-input">
                        <textarea
                            placeholder="Écrivez votre message... (Entrée pour envoyer)"
                            value={input}
                            onChange={(event) => setInput(event.target.value)}
                            onKeyDown={handleKeyDown}
                            rows={1}
                        />
                        <motion.button
                            className={`send-button ${loading ? 'loading' : ''}`}
                            onClick={handleSend}
                            disabled={!canSend}
                            whileHover={{ scale: canSend ? 1.05 : 1 }}
                            whileTap={{ scale: canSend ? 0.95 : 1 }}
                        >
                            {loading ? '⏳' : '➤'}
                        </motion.button>
                    </div>
                </div>
            </section>

            {error && (
                <div className="agent-error">
                    <span>⚠️</span>
                    <p>{error}</p>
                </div>
            )}
        </div>
    );
};
