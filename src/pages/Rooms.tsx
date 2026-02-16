import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { hueApi } from '../services/hueApi';
import type { LightWithId } from '../types/hue';
import './Rooms.css';

interface Group {
  id: string;
  name: string;
  type: string;
  lights: string[];
  state?: {
    all_on: boolean;
    any_on: boolean;
  };
  class?: string;
}

export const Rooms = () => {
  const [groups, setGroups] = useState<Group[]>([]);
  const [allLights, setAllLights] = useState<LightWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setError(null);
      const [fetchedGroups, fetchedLights] = await Promise.all([
        hueApi.getGroups(),
        hueApi.getLights(),
      ]);

      // Sort groups by name, put rooms first
      const sortedGroups = fetchedGroups.sort((a: Group, b: Group) => {
        if (a.type === 'Room' && b.type !== 'Room') return -1;
        if (a.type !== 'Room' && b.type === 'Room') return 1;
        return a.name.localeCompare(b.name);
      });

      setGroups(sortedGroups);
      setAllLights(fetchedLights);
    } catch (err) {
      console.error('Failed to fetch data:', err);
      setError('Failed to load rooms. Check your connection.');
    } finally {
      setLoading(false);
    }
  };

  const handleGroupToggle = async (groupId: string, on: boolean) => {
    try {
      await hueApi.setGroupState(groupId, { on });

      // Refresh data
      setTimeout(() => {
        loadData();
      }, 300);
    } catch (err) {
      console.error('Failed to toggle group:', err);
      setError('Failed to control room');
    }
  };

  const getGroupIcon = (group: Group): string => {
    const name = group.name.toLowerCase();
    const groupClass = group.class?.toLowerCase() || '';

    // Based on class
    if (groupClass.includes('living')) return '🛋️';
    if (groupClass.includes('bedroom')) return '🛏️';
    if (groupClass.includes('kitchen')) return '🍳';
    if (groupClass.includes('bathroom')) return '🚿';
    if (groupClass.includes('office')) return '💼';
    if (groupClass.includes('hallway')) return '🚪';
    if (groupClass.includes('garage')) return '🚗';
    if (groupClass.includes('garden') || groupClass.includes('outdoor')) return '🌳';

    // Based on name
    if (name.includes('salon') || name.includes('living')) return '🛋️';
    if (name.includes('chambre') || name.includes('bedroom')) return '🛏️';
    if (name.includes('cuisine') || name.includes('kitchen')) return '🍳';
    if (name.includes('salle de bain') || name.includes('bathroom')) return '🚿';
    if (name.includes('bureau') || name.includes('office')) return '💼';
    if (name.includes('couloir') || name.includes('hallway')) return '🚪';
    if (name.includes('garage')) return '🚗';
    if (name.includes('jardin') || name.includes('garden')) return '🌳';
    if (name.includes('terrace') || name.includes('terrasse')) return '🏡';
    if (name.includes('dining') || name.includes('salle à manger')) return '🍽️';

    // Default by type
    if (group.type === 'Room') return '🏠';
    if (group.type === 'Zone') return '🗺️';

    return '💡';
  };

  const getLightsInGroup = (group: Group): LightWithId[] => {
    return allLights.filter(light => group.lights.includes(light.id));
  };

  const getLightsOnCount = (group: Group): number => {
    const groupLights = getLightsInGroup(group);
    return groupLights.filter(light => light.state.on).length;
  };

  if (loading) {
    return (
      <div className="rooms-page">
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
          <p className="loading-text">Loading rooms...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rooms-page">
      <motion.header
        className="rooms-header"
        initial={{ y: -50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
      >
        <h1>Rooms & Zones</h1>
        <p className="subtitle">Control lights by room</p>
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

      <div className="rooms-grid">
        {groups.length === 0 ? (
          <motion.div
            className="empty-state"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <p>No rooms found</p>
          </motion.div>
        ) : (
          groups.map((group, index) => {
            const groupLights = getLightsInGroup(group);
            const lightsOn = getLightsOnCount(group);
            const isExpanded = expandedGroup === group.id;

            return (
              <motion.div
                key={group.id}
                className={`room-card glass ${group.state?.any_on ? 'has-lights-on' : ''}`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <div className="room-header">
                  <div className="room-icon">{getGroupIcon(group)}</div>

                  <div className="room-info">
                    <h3 className="room-name">{group.name}</h3>
                    <p className="room-type">
                      {group.type} • {groupLights.length} light{groupLights.length !== 1 ? 's' : ''}
                    </p>
                  </div>

                  <div className="room-status">
                    <span className={`status-badge ${group.state?.any_on ? 'on' : 'off'}`}>
                      {lightsOn}/{groupLights.length} On
                    </span>
                  </div>
                </div>

                <div className="room-controls">
                  <motion.button
                    className="control-btn btn-on"
                    onClick={() => handleGroupToggle(group.id, true)}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    💡 All On
                  </motion.button>

                  <motion.button
                    className="control-btn btn-off"
                    onClick={() => handleGroupToggle(group.id, false)}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    🌙 All Off
                  </motion.button>

                  <motion.button
                    className="control-btn btn-expand"
                    onClick={() => setExpandedGroup(isExpanded ? null : group.id)}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    {isExpanded ? '▲' : '▼'} Details
                  </motion.button>
                </div>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      className="room-lights"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.3 }}
                    >
                      <h4>Lights in this room:</h4>
                      <div className="lights-list">
                        {groupLights.map(light => (
                          <div
                            key={light.id}
                            className={`light-item ${light.state.on ? 'light-on' : 'light-off'}`}
                          >
                            <span className="light-dot" />
                            <span className="light-item-name">{light.name}</span>
                            <span className="light-item-status">
                              {light.state.on
                                ? `${Math.round((light.state.bri / 254) * 100)}%`
                                : 'Off'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })
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
          <li>Control all lights in a room at once with the group controls</li>
          <li>Click "Details" to see individual lights in each room</li>
          <li>Create and manage rooms in the official Philips Hue app</li>
        </ul>
      </motion.div>
    </div>
  );
};
