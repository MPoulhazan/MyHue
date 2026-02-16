import axios from 'axios';
import type { HueLightsResponse, LightWithId } from '../types/hue';

const BRIDGE_IP = import.meta.env.VITE_HUE_BRIDGE_IP;
const USERNAME = import.meta.env.VITE_HUE_USERNAME;

if (!BRIDGE_IP || !USERNAME) {
  console.warn('⚠️ Hue Bridge IP or Username not configured');
  console.warn('Please check your .env file');
}

// Use HTTP for local bridge communication (HTTPS has CORS/cert issues in browser)
const baseURL = `http://${BRIDGE_IP}/api/${USERNAME}`;

// Create axios instance
const api = axios.create({
  baseURL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const hueApi = {
  /**
   * Get all lights
   */
  async getLights(): Promise<LightWithId[]> {
    try {
      const response = await api.get<HueLightsResponse>('/lights');

      // Transform the object into an array with IDs
      return Object.entries(response.data).map(([id, light]) => ({
        ...light,
        id,
      }));
    } catch (error) {
      console.error('Error fetching lights:', error);
      throw error;
    }
  },

  /**
   * Get a specific light by ID
   */
  async getLight(id: string): Promise<LightWithId> {
    try {
      const response = await api.get<any>(`/lights/${id}`);
      return {
        ...response.data,
        id,
      };
    } catch (error) {
      console.error(`Error fetching light ${id}:`, error);
      throw error;
    }
  },

  /**
   * Toggle light on/off
   */
  async toggleLight(id: string, on: boolean): Promise<void> {
    try {
      await api.put(`/lights/${id}/state`, { on });
    } catch (error) {
      console.error(`Error toggling light ${id}:`, error);
      throw error;
    }
  },

  /**
   * Set light brightness (0-254)
   */
  async setBrightness(id: string, bri: number): Promise<void> {
    try {
      const brightness = Math.max(0, Math.min(254, bri));
      await api.put(`/lights/${id}/state`, { bri: brightness });
    } catch (error) {
      console.error(`Error setting brightness for light ${id}:`, error);
      throw error;
    }
  },

  /**
   * Set light color (hue: 0-65535, sat: 0-254)
   */
  async setColor(id: string, hue: number, sat: number): Promise<void> {
    try {
      const normalizedHue = Math.max(0, Math.min(65535, hue));
      const normalizedSat = Math.max(0, Math.min(254, sat));
      await api.put(`/lights/${id}/state`, {
        hue: normalizedHue,
        sat: normalizedSat
      });
    } catch (error) {
      console.error(`Error setting color for light ${id}:`, error);
      throw error;
    }
  },

  /**
   * Set color temperature (153-500 mired)
   */
  async setColorTemperature(id: string, ct: number): Promise<void> {
    try {
      const colorTemp = Math.max(153, Math.min(500, ct));
      await api.put(`/lights/${id}/state`, { ct: colorTemp });
    } catch (error) {
      console.error(`Error setting color temperature for light ${id}:`, error);
      throw error;
    }
  },

  /**
   * Set RGB color (converts to XY)
   */
  async setRGB(id: string, r: number, g: number, b: number): Promise<void> {
    try {
      // Simple RGB to XY conversion (Gamut B)
      const red = r / 255;
      const green = g / 255;
      const blue = b / 255;

      // Gamma correction
      const r2 = red > 0.04045 ? Math.pow((red + 0.055) / 1.055, 2.4) : red / 12.92;
      const g2 = green > 0.04045 ? Math.pow((green + 0.055) / 1.055, 2.4) : green / 12.92;
      const b2 = blue > 0.04045 ? Math.pow((blue + 0.055) / 1.055, 2.4) : blue / 12.92;

      // Convert to XYZ
      const X = r2 * 0.649926 + g2 * 0.103455 + b2 * 0.197109;
      const Y = r2 * 0.234327 + g2 * 0.743075 + b2 * 0.022598;
      const Z = r2 * 0.000000 + g2 * 0.053077 + b2 * 1.035763;

      // Convert to xy
      const x = X / (X + Y + Z);
      const y = Y / (X + Y + Z);

      await api.put(`/lights/${id}/state`, { xy: [x, y] });
    } catch (error) {
      console.error(`Error setting RGB color for light ${id}:`, error);
      throw error;
    }
  },

  /**
   * Get all groups
   */
  async getGroups(): Promise<any[]> {
    try {
      const response = await api.get<Record<string, any>>('/groups');
      return Object.entries(response.data).map(([id, group]) => ({
        ...(group as object),
        id,
      }));
    } catch (error) {
      console.error('Error fetching groups:', error);
      throw error;
    }
  },

  /**
   * Control a group
   */
  async setGroupState(id: string, state: any): Promise<void> {
    try {
      await api.put(`/groups/${id}/action`, state);
    } catch (error) {
      console.error(`Error setting group ${id} state:`, error);
      throw error;
    }
  },

  /**
   * Get all scenes
   */
  async getScenes(): Promise<any[]> {
    try {
      const response = await api.get<Record<string, any>>('/scenes');
      return Object.entries(response.data).map(([id, scene]) => ({
        ...(scene as object),
        id,
      }));
    } catch (error) {
      console.error('Error fetching scenes:', error);
      throw error;
    }
  },

  /**
   * Activate a scene
   */
  async activateScene(sceneId: string): Promise<void> {
    try {
      // Find which group this scene belongs to
      const scenes = await this.getScenes();
      const scene = scenes.find((s: any) => s.id === sceneId);

      if (scene && scene.group) {
        await api.put(`/groups/${scene.group}/action`, { scene: sceneId });
      } else {
        // Fallback: activate on group 0 (all lights)
        await api.put('/groups/0/action', { scene: sceneId });
      }
    } catch (error) {
      console.error(`Error activating scene ${sceneId}:`, error);
      throw error;
    }
  },

  /**
   * Set all lights on/off
   */
  async toggleAllLights(on: boolean): Promise<void> {
    try {
      const lights = await this.getLights();
      await Promise.all(
        lights.map((light) => this.toggleLight(light.id, on))
      );
    } catch (error) {
      console.error('Error toggling all lights:', error);
      throw error;
    }
  },
};
