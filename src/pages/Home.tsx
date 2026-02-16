import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LightCard } from '../components/LightCard';
import { hueApi } from '../services/hueApi';
import { useTracking } from '../hooks/useTracking';
import type { LightWithId } from '../types/hue';
import './Home.css';

export const Home = () => {
  const [lights, setLights] = useState<LightWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Auto-tracking hook
  useTracking(lights);

  const fetchLights = async () => {
    try {
      setError(null);
      const fetchedLights = await hueApi.getLights();
      setLights(fetchedLights);
    } catch (err) {
      console.error('Failed to fetch lights:', err);
      setError('Failed to connect to Hue Bridge. Check your configuration.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchLights();

    // Poll every 5 seconds for real-time updates
    const interval = setInterval(fetchLights, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleToggleLight = async (id: string, on: boolean) => {
    try {
      // Optimistic update
      setLights(prevLights =>
        prevLights.map(light =>
          light.id === id
            ? { ...light, state: { ...light.state, on } }
            : light
        )
      );

      await hueApi.toggleLight(id, on);

      // Refresh to get actual state
      setTimeout(() => {
        fetchLights();
      }, 300);
    } catch (err) {
      console.error('Failed to toggle light:', err);
      // Revert optimistic update
      fetchLights();
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    fetchLights();
  };

  const handleToggleAll = async (on: boolean) => {
    try {
      // Optimistic update
      setLights(prevLights =>
        prevLights.map(light => ({
          ...light,
          state: { ...light.state, on }
        }))
      );

      await hueApi.toggleAllLights(on);

      // Refresh to get actual state
      setTimeout(() => {
        fetchLights();
      }, 300);
    } catch (err) {
      console.error('Failed to toggle all lights:', err);
      fetchLights();
    }
  };

  const lightsOn = lights.filter(light => light.state.on).length;
  const lightsOff = lights.length - lightsOn;

  if (loading) {
    return (
      <div className="home-container">
        <div className="loading-container">
          <motion.div
            className="loading-spinner"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          >
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22"
                stroke="url(#gradient)"
                strokeWidth="3"
                strokeLinecap="round"
              />
              <defs>
                <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#6366f1" />
                  <stop offset="100%" stopColor="#ec4899" />
                </linearGradient>
              </defs>
            </svg>
          </motion.div>
          <p className="loading-text">Connecting to Hue Bridge...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="home-container">
        <div className="error-container">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="error-icon"
          >
            ⚠️
          </motion.div>
          <h2>Connection Error</h2>
          <p>{error}</p>
          <div className="error-help">
            <p>Make sure you have:</p>
            <ul>
              <li>Run <code>npm run discover-bridge</code></li>
              <li>Run <code>npm run generate-token</code></li>
              <li>Updated your <code>.env</code> file</li>
            </ul>
          </div>
          <motion.button
            className="retry-button"
            onClick={handleRefresh}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            Retry Connection
          </motion.button>
        </div>
      </div>
    );
  }

  return (
    <div className="home-container">
      <motion.header
        className="home-header"
        initial={{ y: -50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        <div className="header-content">
          <div className="header-left">
            <h1>Control Panel</h1>
            <p className="subtitle">Manage your lights</p>
          </div>

          <div className="header-stats">
            <div className="stat">
              <span className="stat-value">{lights.length}</span>
              <span className="stat-label">Total</span>
            </div>
            <div className="stat">
              <span className="stat-value stat-on">{lightsOn}</span>
              <span className="stat-label">On</span>
            </div>
            <div className="stat">
              <span className="stat-value stat-off">{lightsOff}</span>
              <span className="stat-label">Off</span>
            </div>
          </div>
        </div>

        <div className="header-actions">
          <motion.button
            className="action-button"
            onClick={() => handleToggleAll(true)}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <span>💡</span> All On
          </motion.button>
          <motion.button
            className="action-button"
            onClick={() => handleToggleAll(false)}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <span>🌙</span> All Off
          </motion.button>
          <motion.button
            className="action-button refresh-button"
            onClick={handleRefresh}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            animate={{ rotate: refreshing ? 360 : 0 }}
            transition={{ duration: 0.5 }}
          >
            <span>🔄</span> Refresh
          </motion.button>
        </div>
      </motion.header>

      <main className="home-main">
        <AnimatePresence mode="popLayout">
          {lights.length === 0 ? (
            <motion.div
              className="empty-state"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <p>No lights found</p>
            </motion.div>
          ) : (
            <motion.div
              className="lights-grid"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {lights.map((light, index) => (
                <motion.div
                  key={light.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <LightCard light={light} onToggle={handleToggleLight} />
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
};
