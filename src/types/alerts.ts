export type AlertType = 'long_running' | 'high_consumption' | 'abnormal_usage';
export type AlertSeverity = 'warning' | 'info' | 'critical';

export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  lightId: string;
  lightName: string;
  message: string;
  timestamp: number;
  dismissed: boolean;
  metadata?: {
    duration?: number; // minutes
    consumption?: number; // kWh
    threshold?: number;
  };
}

export interface AlertStats {
  totalAlerts: number;
  activeAlerts: number;
  dismissedAlerts: number;
  criticalAlerts: number;
}
