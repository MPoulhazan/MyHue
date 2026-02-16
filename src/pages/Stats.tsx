import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { trackingService } from '../services/trackingService';
import type { ConsumptionData } from '../types/tracking';
import { Heatmap } from '../components/Heatmap';
import './Stats.css';

export const Stats = () => {
  const [hourlyData, setHourlyData] = useState<any[]>([]);
  const [consumptionData, setConsumptionData] = useState<ConsumptionData[]>([]);
  const [heatmapData, setHeatmapData] = useState<any[]>([]);
  const [topLights, setTopLights] = useState<ConsumptionData[]>([]);
  const [weekComparison, setWeekComparison] = useState<any>(null);
  const [monthlyPrediction, setMonthlyPrediction] = useState({ predictedEnergyKwh: 0, predictedCostCAD: 0 });
  const [totalStats, setTotalStats] = useState({
    totalEnergyKwh: 0,
    totalCostCAD: 0,
    totalMinutes: 0,
  });

  useEffect(() => {
    const loadData = () => {
      setHourlyData(trackingService.getHourlyConsumption());
      setConsumptionData(trackingService.getLast24HoursConsumption());
      setHeatmapData(trackingService.getHeatmapData());
      setTopLights(trackingService.getTopConsumingLights(3));
      setWeekComparison(trackingService.getWeekOverWeekComparison());
      setMonthlyPrediction(trackingService.getMonthlyPrediction());
      setTotalStats(trackingService.getTotalStats());
    };

    loadData();

    // Refresh every 30 seconds
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = (minutes: number): string => {
    const hours = Math.floor(minutes / 60);
    const mins = Math.floor(minutes % 60);
    return `${hours}h ${mins}m`;
  };

  return (
    <div className="stats-page">
      <motion.header
        className="stats-header"
        initial={{ y: -50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
      >
        <h1>Energy Statistics</h1>
        <p className="subtitle">Last 24 hours</p>
      </motion.header>

      {/* Summary Cards */}
      <div className="stats-summary">
        <motion.div
          className="stat-card glass"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <div className="stat-icon">⚡</div>
          <div className="stat-content">
            <h3>Total Energy</h3>
            <p className="stat-value">
              {totalStats.totalEnergyKwh.toFixed(3)} kWh
            </p>
          </div>
        </motion.div>

        <motion.div
          className="stat-card glass"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <div className="stat-icon">💰</div>
          <div className="stat-content">
            <h3>Total Cost</h3>
            <p className="stat-value cost">
              ${totalStats.totalCostCAD.toFixed(4)} CAD
            </p>
          </div>
        </motion.div>

        <motion.div
          className="stat-card glass"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <div className="stat-icon">⏱️</div>
          <div className="stat-content">
            <h3>Total Time On</h3>
            <p className="stat-value">{formatTime(totalStats.totalMinutes)}</p>
          </div>
        </motion.div>

        <motion.div
          className="stat-card glass"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
        >
          <div className="stat-icon">📅</div>
          <div className="stat-content">
            <h3>Monthly Prediction</h3>
            <p className="stat-value prediction">
              ${monthlyPrediction.predictedCostCAD.toFixed(2)} CAD
            </p>
            <p className="stat-subtext">{monthlyPrediction.predictedEnergyKwh.toFixed(2)} kWh</p>
          </div>
        </motion.div>
      </div>

      {/* Week-over-Week Comparison */}
      {weekComparison && weekComparison.previousWeek.totalEnergyKwh > 0 && (
        <motion.div
          className="comparison-card glass"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <h2>📊 Week-over-Week Comparison</h2>
          <div className="comparison-content">
            <div className="week-stat">
              <span className="week-label">Current Week</span>
              <span className="week-value">{weekComparison.currentWeek.totalEnergyKwh.toFixed(3)} kWh</span>
              <span className="week-cost">${weekComparison.currentWeek.totalCostCAD.toFixed(4)}</span>
            </div>
            <div className="comparison-arrow">
              <div className={`change-indicator ${weekComparison.percentageChange > 0 ? 'increase' : 'decrease'}`}>
                {weekComparison.percentageChange > 0 ? '📈' : '📉'}
                <span>{Math.abs(weekComparison.percentageChange).toFixed(1)}%</span>
              </div>
            </div>
            <div className="week-stat">
              <span className="week-label">Previous Week</span>
              <span className="week-value">{weekComparison.previousWeek.totalEnergyKwh.toFixed(3)} kWh</span>
              <span className="week-cost">${weekComparison.previousWeek.totalCostCAD.toFixed(4)}</span>
            </div>
          </div>
        </motion.div>
      )}

      {/* Top Consuming Lights */}
      {topLights.length > 0 && (
        <motion.div
          className="top-lights glass"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
        >
          <h2>🏆 Top Energy Consumers (Last 24h)</h2>
          <div className="podium">
            {topLights.map((light, index) => (
              <motion.div
                key={light.lightId}
                className={`podium-item rank-${index + 1}`}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 + index * 0.1 }}
              >
                <div className="podium-rank">{['🥇', '🥈', '🥉'][index]}</div>
                <div className="podium-content">
                  <h3>{light.lightName}</h3>
                  <p className="podium-type">{light.lampType}</p>
                  <p className="podium-energy">{light.energyKwh.toFixed(4)} kWh</p>
                  <p className="podium-cost">${light.costCAD.toFixed(4)}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Usage Heatmap */}
      <motion.div
        className="chart-container glass"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
      >
        <h2>🔥 Usage Heatmap (Last 7 Days)</h2>
        <p className="chart-subtitle">Darker cells indicate higher energy consumption</p>
        <Heatmap data={heatmapData} />
      </motion.div>

      {/* Hourly Consumption Chart */}
      <motion.div
        className="chart-container glass"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <h2>Hourly Energy Consumption</h2>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={hourlyData}>
            <defs>
              <linearGradient id="colorEnergy" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.8} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
            <XAxis
              dataKey="hour"
              stroke="rgba(255,255,255,0.5)"
              style={{ fontSize: '12px' }}
            />
            <YAxis
              stroke="rgba(255,255,255,0.5)"
              style={{ fontSize: '12px' }}
              label={{ value: 'kWh', angle: -90, position: 'insideLeft' }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'rgba(10, 10, 15, 0.9)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '8px',
                color: '#fff',
              }}
              formatter={(value: number | undefined) => [
                `${(value || 0).toFixed(4)} kWh`,
                'Energy',
              ]}
            />
            <Area
              type="monotone"
              dataKey="energy"
              stroke="#6366f1"
              fillOpacity={1}
              fill="url(#colorEnergy)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </motion.div>

      {/* Per-Light Consumption */}
      <motion.div
        className="chart-container glass"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
      >
        <h2>Consumption by Light</h2>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={consumptionData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
            <XAxis
              dataKey="lightName"
              stroke="rgba(255,255,255,0.5)"
              style={{ fontSize: '12px' }}
            />
            <YAxis
              stroke="rgba(255,255,255,0.5)"
              style={{ fontSize: '12px' }}
              label={{ value: 'kWh', angle: -90, position: 'insideLeft' }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'rgba(10, 10, 15, 0.9)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '8px',
                color: '#fff',
              }}
              formatter={(value: number | undefined) => [`${(value || 0).toFixed(4)} kWh`, 'Energy']}
            />
            <Legend />
            <Bar dataKey="energyKwh" fill="#14f195" name="Energy (kWh)" />
          </BarChart>
        </ResponsiveContainer>
      </motion.div>

      {/* Detailed Table */}
      <motion.div
        className="consumption-table glass"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
      >
        <h2>Detailed Breakdown</h2>
        <table>
          <thead>
            <tr>
              <th>Light Name</th>
              <th>Lamp Type</th>
              <th>Time On</th>
              <th>Energy (kWh)</th>
              <th>Cost (CAD)</th>
            </tr>
          </thead>
          <tbody>
            {consumptionData.length === 0 ? (
              <tr>
                <td colSpan={5} className="no-data">
                  No data yet. Start using your lights to see statistics!
                </td>
              </tr>
            ) : (
              consumptionData.map(item => (
                <tr key={item.lightId}>
                  <td>{item.lightName}</td>
                  <td className="lamp-type">{item.lampType}</td>
                  <td>{formatTime(item.totalMinutes)}</td>
                  <td>{item.energyKwh.toFixed(4)}</td>
                  <td className="cost">${item.costCAD.toFixed(4)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </motion.div>

      {/* Info Box */}
      <motion.div
        className="info-box glass"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.7 }}
      >
        <h3>ℹ️ Calculation Details</h3>
        <ul>
          <li>Power consumption detected automatically per lamp type</li>
          <li>Standard bulbs: 9W, Spots: 5-6W, Lightstrips: 20W, Ceiling lights: 30-40W</li>
          <li>Electricity rate: $0.06319/kWh (Hydro-Québec Tarif D)</li>
          <li>Brightness is factored into consumption calculations</li>
          <li>Data is stored locally in your browser</li>
        </ul>
      </motion.div>
    </div>
  );
};
