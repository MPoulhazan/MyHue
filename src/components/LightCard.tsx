import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import type { LightWithId } from '../types/hue';
import { ColorPicker } from './ColorPicker';
import { hueApi } from '../services/hueApi';
import './LightCard.css';

interface LightCardProps {
  light: LightWithId;
  onToggle: (id: string, on: boolean) => void;
}

export const LightCard = ({ light, onToggle }: LightCardProps) => {
  const [expanded, setExpanded] = useState(false);
  const isOn = light.state.on;
  const isReachable = light.state.reachable;

  // Check if light supports color
  const supportsColor = light.state.colormode !== undefined;

  const handleClick = (e: React.MouseEvent) => {
    // Don't toggle if clicking on controls
    if ((e.target as HTMLElement).closest('.light-controls')) {
      return;
    }

    if (isReachable) {
      onToggle(light.id, !isOn);
    }
  };

  const handleExpandToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(!expanded);
  };

  const handleColorChange = async (r: number, g: number, b: number) => {
    try {
      await hueApi.setRGB(light.id, r, g, b);
    } catch (error) {
      console.error('Failed to set color:', error);
    }
  };

  const handleBrightnessChange = async (brightness: number) => {
    try {
      await hueApi.setBrightness(light.id, brightness);
    } catch (error) {
      console.error('Failed to set brightness:', error);
    }
  };

  const handleTemperatureChange = async (temp: number) => {
    try {
      await hueApi.setColorTemperature(light.id, temp);
    } catch (error) {
      console.error('Failed to set temperature:', error);
    }
  };

  // Calculate light color based on state
  const getLightColor = () => {
    if (!isOn) return 'rgba(255, 255, 255, 0.1)';

    if (light.state.colormode === 'xy' && light.state.xy) {
      // Approximate RGB from XY
      return `rgba(255, ${Math.round(light.state.bri)}, 100, 0.6)`;
    }

    if (light.state.colormode === 'ct') {
      // Color temperature - warm to cool
      return 'rgba(255, 220, 150, 0.6)';
    }

    // Default white light
    const brightness = (light.state.bri / 254) * 100;
    return `rgba(255, 255, 255, ${brightness / 100})`;
  };

  return (
    <motion.div
      className={`light-card ${isOn ? 'light-on' : 'light-off'} ${!isReachable ? 'unreachable' : ''} ${expanded ? 'expanded' : ''}`}
      onClick={handleClick}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: isReachable && !expanded ? 1.05 : 1, y: isReachable && !expanded ? -5 : 0 }}
      whileTap={{ scale: isReachable && !expanded ? 0.98 : 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      style={{
        '--light-color': getLightColor(),
      } as React.CSSProperties}
    >
      <div className="light-card-glow" />

      <div className="light-card-content">
        {/* Light bulb icon */}
        <motion.div
          className="light-icon"
          animate={{
            scale: isOn ? [1, 1.1, 1] : 1,
            rotate: isOn ? [0, 5, -5, 0] : 0,
          }}
          transition={{
            duration: 2,
            repeat: isOn ? Infinity : 0,
            repeatType: 'reverse',
          }}
        >
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M12 2C8.13 2 5 5.13 5 9C5 11.38 6.19 13.47 8 14.74V17C8 17.55 8.45 18 9 18H15C15.55 18 16 17.55 16 17V14.74C17.81 13.47 19 11.38 19 9C19 5.13 15.87 2 12 2ZM14.85 13.1L14 13.7V16H10V13.7L9.15 13.1C7.8 12.16 7 10.63 7 9C7 6.24 9.24 4 12 4C14.76 4 17 6.24 17 9C17 10.63 16.2 12.16 14.85 13.1Z"
              fill={isOn ? 'currentColor' : 'rgba(255, 255, 255, 0.3)'}
            />
            <path
              d="M9 19H15V20H9V19ZM10 21H14V22H10V21Z"
              fill={isOn ? 'currentColor' : 'rgba(255, 255, 255, 0.3)'}
            />
          </svg>
        </motion.div>

        {/* Light name */}
        <h3 className="light-name">{light.name}</h3>

        {/* Light info */}
        <div className="light-info">
          <span className="light-type">{light.type}</span>
          {isOn && (
            <motion.span
              className="light-brightness"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              {Math.round((light.state.bri / 254) * 100)}%
            </motion.span>
          )}
        </div>

        {/* Status indicator */}
        <div className="status-container">
          <motion.div
            className={`status-dot ${isOn ? 'status-on' : 'status-off'}`}
            animate={{
              scale: isOn ? [1, 1.2, 1] : 1,
              opacity: isOn ? [1, 0.7, 1] : 0.5,
            }}
            transition={{
              duration: 2,
              repeat: isOn ? Infinity : 0,
            }}
          />
          <span className="status-text">
            {!isReachable ? 'Unreachable' : isOn ? 'On' : 'Off'}
          </span>
        </div>

        {/* Expand button */}
        {isOn && isReachable && (
          <motion.button
            className="expand-button"
            onClick={handleExpandToggle}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            {expanded ? '▲' : '▼'}
          </motion.button>
        )}

        {/* Expanded controls */}
        <AnimatePresence>
          {expanded && isOn && (
            <motion.div
              className="light-controls"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3 }}
            >
              <ColorPicker
                onColorChange={handleColorChange}
                onBrightnessChange={handleBrightnessChange}
                onTemperatureChange={handleTemperatureChange}
                currentBrightness={light.state.bri}
                supportsColor={supportsColor}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};
