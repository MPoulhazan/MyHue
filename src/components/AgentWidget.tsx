import { useState, useRef, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { agentApi, type AgentMessage } from '../services/agentApi';
import './AgentWidget.css';

export const AgentWidget = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState<AgentMessage[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const isAgentPage = location.pathname === '/agent';

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, loading]);

    useEffect(() => {
        if (open) inputRef.current?.focus();
    }, [open]);

    const canSend = useMemo(() => input.trim().length > 0 && !loading, [input, loading]);

    // Hide on agent page (after all hooks)
    if (isAgentPage) return null;

    const handleSend = async () => {
        if (!canSend) return;
        const message = input.trim();
        setInput('');
        setError(null);
        setLoading(true);
        setMessages(prev => [...prev, { role: 'user', content: message }]);

        try {
            const response = await agentApi.sendMessage(message, messages);
            if (response.error) {
                setError(response.error);
            } else {
                setMessages(prev => [...prev, { role: 'assistant', content: response.message }]);
            }
        } catch (err: any) {
            setError(err?.response?.data?.error || err?.message || 'Erreur inconnue');
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

    return (
        <>
            <AnimatePresence>
                {open && (
                    <motion.div
                        className="agent-widget-popup"
                        initial={{ opacity: 0, y: 20, scale: 0.9 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 20, scale: 0.9 }}
                        transition={{ duration: 0.2 }}
                    >
                        <div className="widget-header">
                            <span className="widget-title">Assistant IA</span>
                            <div className="widget-header-actions">
                                <button
                                    className="widget-expand-btn"
                                    onClick={() => { setOpen(false); navigate('/agent'); }}
                                    title="Ouvrir en plein écran"
                                >
                                    ↗
                                </button>
                                <button
                                    className="widget-close-btn"
                                    onClick={() => setOpen(false)}
                                >
                                    ✕
                                </button>
                            </div>
                        </div>

                        <div className="widget-messages">
                            {messages.length === 0 && !loading && (
                                <div className="widget-empty">
                                    Posez une question ou donnez un ordre...
                                </div>
                            )}

                            {messages.map((msg, i) => (
                                <div key={i} className={`widget-bubble ${msg.role}`}>
                                    {msg.content}
                                </div>
                            ))}

                            {loading && (
                                <div className="widget-typing">
                                    <span /><span /><span />
                                </div>
                            )}

                            <div ref={messagesEndRef} />
                        </div>

                        {error && (
                            <div className="widget-error">{error}</div>
                        )}

                        <div className="widget-input">
                            <textarea
                                ref={inputRef}
                                placeholder="Message..."
                                value={input}
                                onChange={e => setInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                rows={1}
                            />
                            <button
                                onClick={handleSend}
                                disabled={!canSend}
                                className="widget-send"
                            >
                                {loading ? '...' : '➤'}
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <motion.button
                className="agent-widget-fab"
                onClick={() => setOpen(prev => !prev)}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                animate={open ? { rotate: 0 } : {}}
            >
                {open ? '✕' : '🤖'}
            </motion.button>
        </>
    );
};
