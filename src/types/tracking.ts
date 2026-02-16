export interface LightStateChange {
  lightId: string;
  lightName: string;
  timestamp: number;
  on: boolean;
  brightness: number;
}

export interface LightSession {
  lightId: string;
  lightName: string;
  startTime: number;
  endTime?: number;
  averageBrightness: number;
  wattage: number;
}

export interface ConsumptionData {
  lightId: string;
  lightName: string;
  totalMinutes: number;
  energyKwh: number;
  costCAD: number;
  wattage: number;
  lampType: string;
}

export interface DailyStats {
  date: string;
  totalEnergyKwh: number;
  totalCostCAD: number;
  lightStats: ConsumptionData[];
}
