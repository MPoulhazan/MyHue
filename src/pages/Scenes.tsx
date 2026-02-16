import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { hueApi } from '../services/hueApi';
import './Scenes.css';

interface Scene {
  id: string;
  name: string;
  type?: string;
  group?: string;
  lights?: string[];
  owner?: string;
  recycle?: boolean;
  locked?: boolean;
  appdata?: any;
  picture?: string;
  lastupdated?: string;
  version?: number;
}

export const Scenes = () => {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activatingScene, setActivatingScene] = useState<string | null>(null);
  const [lastActivated, setLastActivated] = useState<string | null>(null);

  useEffect(() => {
    loadScenes();
  }, []);

  const loadScenes = async () => {
    try {
      setError(null);
      const fetchedScenes = await hueApi.getScenes();

      // Filter out hidden/system scenes and sort by name
      const visibleScenes = fetchedScenes
        .filter((scene: Scene) => !scene.name.startsWith('HIDDEN'))
        .sort((a: Scene, b: Scene) => a.name.localeCompare(b.name));

      setScenes(visibleScenes);
    } catch (err) {
      console.error('Failed to fetch scenes:', err);
      setError('Failed to load scenes. Check your connection.');
    } finally {
      setLoading(false);
    }
  };

  const handleActivateScene = async (sceneId: string, sceneName: string) => {
    try {
      setActivatingScene(sceneId);
      await hueApi.activateScene(sceneId);
      setLastActivated(sceneId);

      // Clear activation state after animation
      setTimeout(() => {
        setActivatingScene(null);
      }, 1000);
    } catch (err) {
      console.error('Failed to activate scene:', err);
      setError(`Failed to activate "${sceneName}"`);
      setActivatingScene(null);
    }
  };

  const getSceneIcon = (sceneName: string): string => {
    const name = sceneName.toLowerCase();

    if (name.includes('relax') || name.includes('chill')) return '🛋️';
    if (name.includes('read') || name.includes('concentrate')) return '📖';
    if (name.includes('energize') || name.includes('focus')) return '⚡';
    if (name.includes('bright') || name.includes('daylight')) return '☀️';
    if (name.includes('dimmed') || name.includes('night')) return '🌙';
    if (name.includes('sunset') || name.includes('orange')) return '🌅';
    if (name.includes('arctic') || name.includes('cool')) return '❄️';
    if (name.includes('spring') || name.includes('blossom')) return '🌸';
    if (name.includes('tropical') || name.includes('summer')) return '🌴';
    if (name.includes('savanna') || name.includes('sunset')) return '🦁';
    if (name.includes('galaxy') || name.includes('space')) return '🌌';
    if (name.includes('movie') || name.includes('cinema')) return '🎬';
    if (name.includes('party') || name.includes('disco')) return '🎉';
    if (name.includes('romantic') || name.includes('love')) return '💕';

    return '💡';
  };

  if (loading) {
    return (
      <div className="scenes-page">
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
          <p className="loading-text">Loading scenes...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="scenes-page">
      <motion.header
        className="scenes-header"
        initial={{ y: -50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
      >
        <h1>Scenes</h1>
        <p className="subtitle">Activate your favorite lighting ambiances</p>
      </motion.header>

      {error && (
        <motion.div
          className="error-banner"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {error}
        </motion.div>
      )}

      <div className="scenes-grid">
        {scenes.length === 0 ? (
          <motion.div
            className="empty-state"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <p>No scenes found. Create some scenes in the Philips Hue app!</p>
          </motion.div>
        ) : (
          scenes.map((scene, index) => (
            <motion.div
              key={scene.id}
              className={`scene-card glass ${
                activatingScene === scene.id ? 'activating' : ''
              } ${lastActivated === scene.id ? 'last-activated' : ''}`}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              whileHover={{ scale: 1.05, y: -5 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => handleActivateScene(scene.id, scene.name)}
            >
              <div className="scene-icon">{getSceneIcon(scene.name)}</div>

              <div className="scene-info">
                <h3 className="scene-name">{scene.name}</h3>
                {scene.lights && (
                  <p className="scene-lights">
                    {scene.lights.length} light{scene.lights.length !== 1 ? 's' : ''}
                  </p>
                )}
              </div>

              {activatingScene === scene.id && (
                <motion.div
                  className="activation-pulse"
                  initial={{ scale: 1, opacity: 1 }}
                  animate={{ scale: 2, opacity: 0 }}
                  transition={{ duration: 1 }}
                />
              )}

              {lastActivated === scene.id && !activatingScene && (
                <div className="active-indicator">
                  <span>✓</span> Active
                </div>
              )}
            </motion.div>
          ))
        )}
      </div>

      <motion.div
        className="info-box glass"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
      >
        <h3>💡 Tips</h3>
        <ul>
          <li>Click on any scene to activate it instantly</li>
          <li>Create and manage scenes in the official Philips Hue app</li>
          <li>Scenes remember brightness, color, and which lights to control</li>
        </ul>
      </motion.div>
    </div>
  );
};
