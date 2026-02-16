import { motion } from 'framer-motion';
import './Heatmap.css';

interface HeatmapProps {
  data: { day: string; hour: number; energy: number }[];
}

export const Heatmap = ({ data }: HeatmapProps) => {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const hours = Array.from({ length: 24 }, (_, i) => i);

  // Find max energy for color scaling
  const maxEnergy = Math.max(...data.map(d => d.energy), 0.001);

  const getColor = (energy: number): string => {
    if (energy === 0) return 'rgba(255, 255, 255, 0.03)';

    const intensity = Math.min(energy / maxEnergy, 1);

    // Gradient from dark blue -> purple -> pink -> bright cyan
    if (intensity < 0.33) {
      const t = intensity / 0.33;
      return `rgba(99, 102, 241, ${0.2 + t * 0.3})`; // Blue
    } else if (intensity < 0.66) {
      const t = (intensity - 0.33) / 0.33;
      return `rgba(139, ${102 - t * 30}, ${241 - t * 90}, ${0.5 + t * 0.2})`; // Purple
    } else {
      const t = (intensity - 0.66) / 0.34;
      return `rgba(${20 + t * 216}, ${72 + t * 169}, ${153 - t * 4}, ${0.7 + t * 0.3})`; // Pink to Cyan
    }
  };

  const getEnergyForCell = (day: string, hour: number): number => {
    const cell = data.find(d => d.day === day && d.hour === hour);
    return cell ? cell.energy : 0;
  };

  return (
    <div className="heatmap-container">
      <div className="heatmap-grid">
        {/* Hour labels on top */}
        <div className="heatmap-corner"></div>
        {hours.map(hour => (
          <div key={`hour-${hour}`} className="heatmap-hour-label">
            {hour % 3 === 0 ? `${hour}h` : ''}
          </div>
        ))}

        {/* Day rows */}
        {days.map((day, dayIndex) => (
          <div key={day} className="heatmap-row">
            <div className="heatmap-day-label">{day}</div>
            {hours.map(hour => {
              const energy = getEnergyForCell(day, hour);
              return (
                <motion.div
                  key={`${day}-${hour}`}
                  className="heatmap-cell"
                  style={{ backgroundColor: getColor(energy) }}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: (dayIndex * 24 + hour) * 0.002 }}
                  whileHover={{ scale: 1.2, zIndex: 10 }}
                  title={`${day} ${hour}:00 - ${energy.toFixed(4)} kWh`}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="heatmap-legend">
        <span className="legend-label">Low</span>
        <div className="legend-gradient"></div>
        <span className="legend-label">High</span>
      </div>
    </div>
  );
};
