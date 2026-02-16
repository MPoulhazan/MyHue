import type { Alert, AlertType, AlertSeverity, AlertStats } from '../types/alerts';
import type { LightWithId } from '../types/hue';
import { trackingService } from './trackingService';

const ALERTS_KEY = 'hue_alerts';

// Alert thresholds
const LONG_RUNNING_THRESHOLD_MINUTES = 120; // 2 hours
const HIGH_CONSUMPTION_THRESHOLD_KWH = 0.05; // 50Wh in last hour
const ABNORMAL_USAGE_MULTIPLIER = 3; // 3x normal usage

export const alertService = {
  /**
   * Get all alerts
   */
  getAllAlerts(): Alert[] {
    const data = localStorage.getItem(ALERTS_KEY);
    return data ? JSON.parse(data) : [];
  },

  /**
   * Get active (non-dismissed) alerts
   */
  getActiveAlerts(): Alert[] {
    return this.getAllAlerts().filter(alert => !alert.dismissed);
  },

  /**
   * Get alerts by type
   */
  getAlertsByType(type: AlertType): Alert[] {
    return this.getAllAlerts().filter(alert => alert.type === type);
  },

  /**
   * Get alert statistics
   */
  getAlertStats(): AlertStats {
    const alerts = this.getAllAlerts();
    return {
      totalAlerts: alerts.length,
      activeAlerts: alerts.filter(a => !a.dismissed).length,
      dismissedAlerts: alerts.filter(a => a.dismissed).length,
      criticalAlerts: alerts.filter(a => a.severity === 'critical' && !a.dismissed).length,
    };
  },

  /**
   * Create a new alert
   */
  createAlert(
    type: AlertType,
    severity: AlertSeverity,
    lightId: string,
    lightName: string,
    message: string,
    metadata?: Alert['metadata']
  ): Alert {
    const alert: Alert = {
      id: `${type}-${lightId}-${Date.now()}`,
      type,
      severity,
      lightId,
      lightName,
      message,
      timestamp: Date.now(),
      dismissed: false,
      metadata,
    };

    const alerts = this.getAllAlerts();
    alerts.push(alert);
    localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts));

    return alert;
  },

  /**
   * Dismiss an alert
   */
  dismissAlert(alertId: string): void {
    const alerts = this.getAllAlerts();
    const alert = alerts.find(a => a.id === alertId);
    if (alert) {
      alert.dismissed = true;
      localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts));
    }
  },

  /**
   * Dismiss all alerts
   */
  dismissAllAlerts(): void {
    const alerts = this.getAllAlerts();
    alerts.forEach(alert => {
      alert.dismissed = true;
    });
    localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts));
  },

  /**
   * Delete an alert
   */
  deleteAlert(alertId: string): void {
    const alerts = this.getAllAlerts().filter(a => a.id !== alertId);
    localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts));
  },

  /**
   * Clear old alerts (older than 7 days)
   */
  clearOldAlerts(): void {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const alerts = this.getAllAlerts().filter(
      alert => alert.timestamp > sevenDaysAgo
    );
    localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts));
  },

  /**
   * Check for long-running lights and create alerts
   */
  checkLongRunningLights(lights: LightWithId[]): Alert[] {
    const newAlerts: Alert[] = [];
    const sessions = trackingService.getActiveSessions();
    const now = Date.now();

    // Find active sessions (lights currently on)
    const activeSessions = sessions.filter(s => !s.endTime);

    activeSessions.forEach(session => {
      const durationMinutes = (now - session.startTime) / (1000 * 60);

      // Check if already alerted for this session
      const existingAlert = this.getAllAlerts().find(
        a =>
          a.type === 'long_running' &&
          a.lightId === session.lightId &&
          !a.dismissed &&
          a.timestamp > session.startTime
      );

      if (durationMinutes > LONG_RUNNING_THRESHOLD_MINUTES && !existingAlert) {
        const hours = Math.floor(durationMinutes / 60);
        const mins = Math.floor(durationMinutes % 60);

        const alert = this.createAlert(
          'long_running',
          durationMinutes > 240 ? 'critical' : 'warning', // Critical after 4 hours
          session.lightId,
          session.lightName,
          `Light has been on for ${hours}h ${mins}m`,
          { duration: durationMinutes }
        );

        newAlerts.push(alert);
      }
    });

    return newAlerts;
  },

  /**
   * Check for high consumption and create alerts
   */
  checkHighConsumption(): Alert[] {
    const newAlerts: Alert[] = [];
    const consumptionData = trackingService.getLast24HoursConsumption();

    consumptionData.forEach(item => {
      // Check if consumption in last 24h is unusually high
      if (item.energyKwh > HIGH_CONSUMPTION_THRESHOLD_KWH * 24) {
        // Check if already alerted recently (last hour)
        const oneHourAgo = Date.now() - 60 * 60 * 1000;
        const existingAlert = this.getAllAlerts().find(
          a =>
            a.type === 'high_consumption' &&
            a.lightId === item.lightId &&
            !a.dismissed &&
            a.timestamp > oneHourAgo
        );

        if (!existingAlert) {
          const alert = this.createAlert(
            'high_consumption',
            'info',
            item.lightId,
            item.lightName,
            `High energy usage: ${item.energyKwh.toFixed(3)} kWh in last 24h ($${item.costCAD.toFixed(4)})`,
            { consumption: item.energyKwh }
          );

          newAlerts.push(alert);
        }
      }
    });

    return newAlerts;
  },

  /**
   * Check for abnormal usage patterns
   */
  checkAbnormalUsage(): Alert[] {
    const newAlerts: Alert[] = [];
    const weekComparison = trackingService.getWeekOverWeekComparison();

    // Alert if current week usage is 3x higher than previous week
    if (
      weekComparison.previousWeek.totalEnergyKwh > 0 &&
      weekComparison.percentageChange > (ABNORMAL_USAGE_MULTIPLIER - 1) * 100
    ) {
      const existingAlert = this.getAllAlerts().find(
        a =>
          a.type === 'abnormal_usage' &&
          !a.dismissed &&
          a.timestamp > Date.now() - 24 * 60 * 60 * 1000 // Last 24h
      );

      if (!existingAlert) {
        const alert = this.createAlert(
          'abnormal_usage',
          'warning',
          'overall',
          'Overall System',
          `Energy usage is ${weekComparison.percentageChange.toFixed(0)}% higher than last week`,
          { threshold: weekComparison.percentageChange }
        );

        newAlerts.push(alert);
      }
    }

    return newAlerts;
  },

  /**
   * Run all checks and return new alerts
   */
  runAllChecks(lights: LightWithId[]): Alert[] {
    // Clean old alerts first
    this.clearOldAlerts();

    const longRunningAlerts = this.checkLongRunningLights(lights);
    const highConsumptionAlerts = this.checkHighConsumption();
    const abnormalUsageAlerts = this.checkAbnormalUsage();

    return [...longRunningAlerts, ...highConsumptionAlerts, ...abnormalUsageAlerts];
  },

  /**
   * Clear all alerts
   */
  clearAllAlerts(): void {
    localStorage.removeItem(ALERTS_KEY);
  },
};
