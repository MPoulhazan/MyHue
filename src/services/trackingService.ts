import type { LightStateChange, LightSession, ConsumptionData, DailyStats } from '../types/tracking';
import type { LightWithId } from '../types/hue';
import { getLampWattage, getLampTypeDescription } from '../utils/lampPower';

const STORAGE_KEY = 'hue_tracking_data';
const SESSIONS_KEY = 'hue_active_sessions';
const LAMP_INFO_KEY = 'hue_lamp_info'; // Store lamp wattage info

// Constants
const HYDRO_QUEBEC_RATE = 0.06319; // $/kWh (Tarif D - premier palier)

interface LampInfo {
  wattage: number;
  lampType: string;
}

export const trackingService = {
  /**
   * Store lamp information for later use
   */
  storeLampInfo(light: LightWithId): void {
    const lampInfoMap = this.getLampInfoMap();
    lampInfoMap[light.id] = {
      wattage: getLampWattage(light),
      lampType: getLampTypeDescription(light),
    };
    localStorage.setItem(LAMP_INFO_KEY, JSON.stringify(lampInfoMap));
  },

  /**
   * Get stored lamp information
   */
  getLampInfoMap(): { [lightId: string]: LampInfo } {
    const data = localStorage.getItem(LAMP_INFO_KEY);
    return data ? JSON.parse(data) : {};
  },

  /**
   * Get lamp info for a specific light
   */
  getLampInfo(lightId: string): LampInfo {
    const lampInfoMap = this.getLampInfoMap();
    return lampInfoMap[lightId] || { wattage: 9, lampType: 'Standard Bulb (9W)' };
  },

  /**
   * Record a state change for a light
   */
  recordStateChange(light: LightWithId): void {
    // Store lamp info first time we see this light
    this.storeLampInfo(light);

    const stateChange: LightStateChange = {
      lightId: light.id,
      lightName: light.name,
      timestamp: Date.now(),
      on: light.state.on,
      brightness: light.state.bri,
    };

    const history = this.getStateHistory();
    history.push(stateChange);

    // Keep only last 7 days of data
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const filtered = history.filter(item => item.timestamp > sevenDaysAgo);

    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));

    // Manage sessions
    if (light.state.on) {
      this.startSession(light);
    } else {
      this.endSession(light.id);
    }
  },

  /**
   * Start a new session when a light turns on
   */
  startSession(light: LightWithId): void {
    const sessions = this.getActiveSessions();

    // Check if session already exists
    if (!sessions.find(s => s.lightId === light.id && !s.endTime)) {
      const session: LightSession = {
        lightId: light.id,
        lightName: light.name,
        startTime: Date.now(),
        averageBrightness: light.state.bri,
        wattage: getLampWattage(light),
      };
      sessions.push(session);
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    }
  },

  /**
   * End a session when a light turns off
   */
  endSession(lightId: string): void {
    const sessions = this.getActiveSessions();
    const sessionIndex = sessions.findIndex(
      s => s.lightId === lightId && !s.endTime
    );

    if (sessionIndex !== -1) {
      sessions[sessionIndex].endTime = Date.now();
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    }
  },

  /**
   * Get all state change history
   */
  getStateHistory(): LightStateChange[] {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  },

  /**
   * Get all sessions (active and completed)
   */
  getActiveSessions(): LightSession[] {
    const data = localStorage.getItem(SESSIONS_KEY);
    return data ? JSON.parse(data) : [];
  },

  /**
   * Calculate consumption for the last 24 hours
   */
  getLast24HoursConsumption(): ConsumptionData[] {
    const sessions = this.getActiveSessions();
    const now = Date.now();
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

    // Group sessions by light
    const lightSessions: { [lightId: string]: LightSession[] } = {};

    sessions.forEach(session => {
      // Only include sessions that overlap with last 24h
      const sessionStart = Math.max(session.startTime, twentyFourHoursAgo);
      const sessionEnd = session.endTime || now;

      if (sessionEnd > twentyFourHoursAgo && sessionStart < now) {
        if (!lightSessions[session.lightId]) {
          lightSessions[session.lightId] = [];
        }
        lightSessions[session.lightId].push({
          ...session,
          startTime: sessionStart,
          endTime: sessionEnd,
        });
      }
    });

    // Calculate consumption per light
    return Object.entries(lightSessions).map(([lightId, sessions]) => {
      let totalMinutes = 0;
      let totalBrightnessMinutes = 0;

      // Get wattage for this lamp (use first session or stored info)
      const wattage = sessions[0]?.wattage || this.getLampInfo(lightId).wattage;
      const lampInfo = this.getLampInfo(lightId);

      sessions.forEach(session => {
        const duration = (session.endTime! - session.startTime) / (1000 * 60);
        totalMinutes += duration;
        // Weight by brightness (brightness is 0-254, we normalize to 0-1)
        const brightnessMultiplier = session.averageBrightness / 254;
        totalBrightnessMinutes += duration * brightnessMultiplier;
      });

      // Calculate energy: (Watts * Hours * Brightness) / 1000 = kWh
      const energyKwh = (wattage * (totalBrightnessMinutes / 60)) / 1000;
      const costCAD = energyKwh * HYDRO_QUEBEC_RATE;

      return {
        lightId,
        lightName: sessions[0].lightName,
        totalMinutes,
        energyKwh,
        costCAD,
        wattage,
        lampType: lampInfo.lampType,
      };
    });
  },

  /**
   * Get hourly consumption for the last 24 hours
   */
  getHourlyConsumption(): { hour: string; energy: number; cost: number }[] {
    const sessions = this.getActiveSessions();
    const now = Date.now();
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

    // Create 24 hourly buckets
    const hourlyData: { [hour: string]: number } = {};

    for (let i = 0; i < 24; i++) {
      const hourStart = new Date(now - (23 - i) * 60 * 60 * 1000);
      const hourKey = `${hourStart.getHours().toString().padStart(2, '0')}:00`;
      hourlyData[hourKey] = 0;
    }

    // Fill buckets with session data
    sessions.forEach(session => {
      const sessionStart = Math.max(session.startTime, twentyFourHoursAgo);
      const sessionEnd = session.endTime || now;

      if (sessionEnd > twentyFourHoursAgo && sessionStart < now) {
        // Get wattage for this session
        const wattage = session.wattage || this.getLampInfo(session.lightId).wattage;

        // Calculate which hours this session spans
        let currentTime = sessionStart;
        while (currentTime < sessionEnd) {
          const hourStart = new Date(currentTime);
          hourStart.setMinutes(0, 0, 0);
          const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000);

          const segmentStart = Math.max(currentTime, hourStart.getTime());
          const segmentEnd = Math.min(sessionEnd, hourEnd.getTime());
          const durationMinutes = (segmentEnd - segmentStart) / (1000 * 60);

          const hourKey = `${hourStart.getHours().toString().padStart(2, '0')}:00`;
          const brightnessMultiplier = session.averageBrightness / 254;
          const energyKwh = (wattage * (durationMinutes / 60) * brightnessMultiplier) / 1000;

          if (hourlyData[hourKey] !== undefined) {
            hourlyData[hourKey] += energyKwh;
          }

          currentTime = hourEnd.getTime();
        }
      }
    });

    return Object.entries(hourlyData).map(([hour, energy]) => ({
      hour,
      energy: parseFloat(energy.toFixed(4)),
      cost: parseFloat((energy * HYDRO_QUEBEC_RATE).toFixed(4)),
    }));
  },

  /**
   * Get total stats for last 24 hours
   */
  getTotalStats(): { totalEnergyKwh: number; totalCostCAD: number; totalMinutes: number } {
    const consumption = this.getLast24HoursConsumption();

    return consumption.reduce(
      (acc, item) => ({
        totalEnergyKwh: acc.totalEnergyKwh + item.energyKwh,
        totalCostCAD: acc.totalCostCAD + item.costCAD,
        totalMinutes: acc.totalMinutes + item.totalMinutes,
      }),
      { totalEnergyKwh: 0, totalCostCAD: 0, totalMinutes: 0 }
    );
  },

  /**
   * Get heatmap data (7 days x 24 hours)
   */
  getHeatmapData(): { day: string; hour: number; energy: number }[] {
    const sessions = this.getActiveSessions();
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    // Create heatmap buckets: 7 days x 24 hours
    const heatmapData: { day: string; hour: number; energy: number }[] = [];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Initialize all buckets
    for (let d = 0; d < 7; d++) {
      const dayDate = new Date(now - (6 - d) * 24 * 60 * 60 * 1000);
      const dayName = dayNames[dayDate.getDay()];

      for (let h = 0; h < 24; h++) {
        heatmapData.push({
          day: dayName,
          hour: h,
          energy: 0,
        });
      }
    }

    // Fill buckets with session data
    sessions.forEach(session => {
      const sessionStart = Math.max(session.startTime, sevenDaysAgo);
      const sessionEnd = session.endTime || now;

      if (sessionEnd > sevenDaysAgo && sessionStart < now) {
        const wattage = session.wattage || this.getLampInfo(session.lightId).wattage;

        let currentTime = sessionStart;
        while (currentTime < sessionEnd) {
          const currentDate = new Date(currentTime);
          const dayOfWeek = dayNames[currentDate.getDay()];
          const hour = currentDate.getHours();

          const hourStart = new Date(currentDate);
          hourStart.setMinutes(0, 0, 0);
          const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000);

          const segmentStart = Math.max(currentTime, hourStart.getTime());
          const segmentEnd = Math.min(sessionEnd, hourEnd.getTime());
          const durationMinutes = (segmentEnd - segmentStart) / (1000 * 60);

          const brightnessMultiplier = session.averageBrightness / 254;
          const energyKwh = (wattage * (durationMinutes / 60) * brightnessMultiplier) / 1000;

          const bucket = heatmapData.find(b => b.day === dayOfWeek && b.hour === hour);
          if (bucket) {
            bucket.energy += energyKwh;
          }

          currentTime = hourEnd.getTime();
        }
      }
    });

    return heatmapData;
  },

  /**
   * Get week-over-week comparison
   */
  getWeekOverWeekComparison(): {
    currentWeek: { totalEnergyKwh: number; totalCostCAD: number; totalMinutes: number };
    previousWeek: { totalEnergyKwh: number; totalCostCAD: number; totalMinutes: number };
    percentageChange: number;
  } {
    const sessions = this.getActiveSessions();
    const now = Date.now();
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const twoWeeksAgo = now - 14 * 24 * 60 * 60 * 1000;

    const calculateWeekStats = (startTime: number, endTime: number) => {
      let totalEnergyKwh = 0;
      let totalMinutes = 0;

      sessions.forEach(session => {
        const sessionStart = Math.max(session.startTime, startTime);
        const sessionEnd = session.endTime || now;

        if (sessionEnd > startTime && sessionStart < endTime) {
          const wattage = session.wattage || this.getLampInfo(session.lightId).wattage;
          const durationMinutes = (Math.min(sessionEnd, endTime) - sessionStart) / (1000 * 60);
          totalMinutes += durationMinutes;

          const brightnessMultiplier = session.averageBrightness / 254;
          totalEnergyKwh += (wattage * (durationMinutes / 60) * brightnessMultiplier) / 1000;
        }
      });

      return {
        totalEnergyKwh,
        totalCostCAD: totalEnergyKwh * HYDRO_QUEBEC_RATE,
        totalMinutes,
      };
    };

    const currentWeek = calculateWeekStats(oneWeekAgo, now);
    const previousWeek = calculateWeekStats(twoWeeksAgo, oneWeekAgo);

    const percentageChange =
      previousWeek.totalEnergyKwh > 0
        ? ((currentWeek.totalEnergyKwh - previousWeek.totalEnergyKwh) / previousWeek.totalEnergyKwh) * 100
        : 0;

    return {
      currentWeek,
      previousWeek,
      percentageChange,
    };
  },

  /**
   * Get top consuming lights
   */
  getTopConsumingLights(limit: number = 3): ConsumptionData[] {
    const consumption = this.getLast24HoursConsumption();
    return consumption
      .sort((a, b) => b.energyKwh - a.energyKwh)
      .slice(0, limit);
  },

  /**
   * Predict monthly bill based on last 7 days
   */
  getMonthlyPrediction(): { predictedEnergyKwh: number; predictedCostCAD: number } {
    const sessions = this.getActiveSessions();
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    let weeklyEnergyKwh = 0;

    sessions.forEach(session => {
      const sessionStart = Math.max(session.startTime, sevenDaysAgo);
      const sessionEnd = session.endTime || now;

      if (sessionEnd > sevenDaysAgo && sessionStart < now) {
        const wattage = session.wattage || this.getLampInfo(session.lightId).wattage;
        const durationMinutes = (sessionEnd - sessionStart) / (1000 * 60);
        const brightnessMultiplier = session.averageBrightness / 254;
        weeklyEnergyKwh += (wattage * (durationMinutes / 60) * brightnessMultiplier) / 1000;
      }
    });

    // Extrapolate to 30 days
    const predictedEnergyKwh = (weeklyEnergyKwh / 7) * 30;
    const predictedCostCAD = predictedEnergyKwh * HYDRO_QUEBEC_RATE;

    return {
      predictedEnergyKwh,
      predictedCostCAD,
    };
  },

  /**
   * Clear all tracking data
   */
  clearData(): void {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SESSIONS_KEY);
    localStorage.removeItem(LAMP_INFO_KEY);
  },
};
