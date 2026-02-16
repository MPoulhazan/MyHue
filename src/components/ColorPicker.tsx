import { motion } from 'framer-motion';
import { useState } from 'react';
import './ColorPicker.css';

interface ColorPickerProps {
  onColorChange: (r: number, g: number, b: number) => void;
  onBrightnessChange: (brightness: number) => void;
  onTemperatureChange: (temp: number) => void;
  currentBrightness: number;
  supportsColor: boolean;
}

const PRESET_COLORS = [
  { name: 'Red', r: 255, g: 0, b: 0 },
  { name: 'Orange', r: 255, g: 128, b: 0 },
  { name: 'Yellow', r: 255, g: 255, b: 0 },
  { name: 'Green', r: 0, g: 255, b: 0 },
  { name: 'Cyan', r: 0, g: 255, b: 255 },
  { name: 'Blue', r: 0, g: 0, b: 255 },
  { name: 'Purple', r: 128, g: 0, b: 255 },
  { name: 'Pink', r: 255, g: 0, b: 128 },
];

export const ColorPicker = ({
  onColorChange,
  onBrightnessChange,
  onTemperatureChange,
  currentBrightness,
  supportsColor,
}: ColorPickerProps) => {
  const [brightness, setBrightness] = useState(currentBrightness);
  const [temperature, setTemperature] = useState(250); // Middle temperature

  const handleBrightnessChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value);
    setBrightness(value);
    onBrightnessChange(value);
  };

  const handleTemperatureChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value);
    setTemperature(value);
    onTemperatureChange(value);
  };

  const handlePresetColor = (r: number, g: number, b: number) => {
    onColorChange(r, g, b);
  };

  return (
    <div className="color-picker">
      {/* Brightness Control */}
      <div className="control-group">
        <label className="control-label">
          <span>💡</span>
          <span>Brightness</span>
          <span className="control-value">{Math.round((brightness / 254) * 100)}%</span>
        </label>
        <input
          type="range"
          min="1"
          max="254"
          value={brightness}
          onChange={handleBrightnessChange}
          className="slider brightness-slider"
        />
      </div>

      {supportsColor && (
        <>
          {/* Preset Colors */}
          <div className="control-group">
            <label className="control-label">
              <span>🎨</span>
              <span>Quick Colors</span>
            </label>
            <div className="color-presets">
              {PRESET_COLORS.map((color) => (
                <motion.button
                  key={color.name}
                  className="color-preset"
                  style={{
                    backgroundColor: `rgb(${color.r}, ${color.g}, ${color.b})`,
                  }}
                  onClick={() => handlePresetColor(color.r, color.g, color.b)}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  title={color.name}
                />
              ))}
            </div>
          </div>

          {/* Temperature Control */}
          <div className="control-group">
            <label className="control-label">
              <span>🌡️</span>
              <span>Temperature</span>
              <span className="control-value">
                {temperature < 200 ? 'Warm' : temperature > 350 ? 'Cool' : 'Neutral'}
              </span>
            </label>
            <input
              type="range"
              min="153"
              max="500"
              value={temperature}
              onChange={handleTemperatureChange}
              className="slider temperature-slider"
            />
            <div className="temperature-labels">
              <span>❄️ Cool</span>
              <span>🔥 Warm</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
