import type { LightWithId } from '../types/hue';

/**
 * Lamp power consumption database (in Watts)
 * Based on official Philips Hue specifications
 */

// Map of model IDs to their wattage
const MODEL_WATTAGE: { [key: string]: number } = {
  // A19/E27 Color Bulbs (Gen 1-3)
  'LCT001': 8.5, 'LCT002': 8.5, 'LCT003': 8.5, 'LCT007': 10,
  'LCT010': 9, 'LCT011': 9, 'LCT012': 9, 'LCT014': 9, 'LCT015': 9, 'LCT016': 9,

  // A19/E27 White Bulbs
  'LWB004': 9, 'LWB006': 9, 'LWB007': 9, 'LWB010': 9, 'LWB014': 9,

  // BR30 Bulbs
  'LCT024': 9,

  // GU10 Spots
  'LCG002': 5.5, 'LLC010': 5.5, 'LLC011': 5.5, 'LLC012': 5.5, 'LLC006': 5.5, 'LLC007': 5.5,

  // E14 Candle
  'LCT012': 6, 'LWE002': 6,

  // Lightstrips
  'LST001': 20, 'LST002': 20, 'LST003': 20, 'LST004': 20,
  'LCL001': 20, // Lightstrip Plus
  'LCX001': 20, // Outdoor Lightstrip
  '915005733701': 20, // Gradient Lightstrip

  // Hue Go
  'LLC020': 6,

  // Hue Bloom
  'LLC011': 8, 'LLC012': 8,

  // Hue Iris
  'LLC010': 10,

  // Hue Play
  'LCT024': 7, 'LCL003': 7,

  // Lightbar
  'LCL002': 9,

  // Downlights
  'LTW001': 6, 'LTW004': 6, 'LTW010': 6, 'LTW012': 6, 'LTW013': 6, 'LTW014': 6, 'LTW015': 6,
  'LTC001': 6, 'LTC002': 6, 'LTC003': 6, 'LTC004': 6,

  // Ceiling Lights (varies significantly)
  'LTC011': 32, 'LTC012': 32, 'LTC013': 32, 'LTC014': 32, 'LTC015': 32, 'LTC016': 32,
  'LTD003': 39, 'LTD011': 39, 'LTD012': 39,

  // Pendant Lights
  'LTP001': 40, 'LTP002': 40, 'LTP003': 40, 'LTP004': 40, 'LTP005': 40,

  // Outdoor
  'LCW001': 8, // Wall lantern
  'LCS001': 15, // Lily spot
};

// Fallback wattages based on product type keywords
const TYPE_FALLBACKS: { pattern: RegExp; wattage: number }[] = [
  { pattern: /strip/i, wattage: 20 },
  { pattern: /ceiling|plafond|plafonnier/i, wattage: 35 },
  { pattern: /pendant|suspension/i, wattage: 40 },
  { pattern: /spot|downlight|encastr/i, wattage: 6 },
  { pattern: /play|bar/i, wattage: 7 },
  { pattern: /go/i, wattage: 6 },
  { pattern: /iris|bloom/i, wattage: 10 },
  { pattern: /outdoor|ext[eé]rieur/i, wattage: 10 },
  { pattern: /candle|bougie|flamme/i, wattage: 6 },
  { pattern: /gu10/i, wattage: 5.5 },
  { pattern: /e14/i, wattage: 6 },
  { pattern: /bulb|ampoule|a19|e27/i, wattage: 9 },
];

/**
 * Detect lamp wattage based on model, product name, and type
 */
export function getLampWattage(light: LightWithId): number {
  // 1. Try exact model match
  if (light.modelid && MODEL_WATTAGE[light.modelid]) {
    return MODEL_WATTAGE[light.modelid];
  }

  // 2. Try product name pattern matching
  const productName = light.productname?.toLowerCase() || '';
  const lightName = light.name.toLowerCase();
  const lightType = light.type.toLowerCase();

  const searchText = `${productName} ${lightName} ${lightType}`;

  for (const { pattern, wattage } of TYPE_FALLBACKS) {
    if (pattern.test(searchText)) {
      return wattage;
    }
  }

  // 3. Default fallback
  return 9; // Standard bulb wattage
}

/**
 * Get a human-readable description of the lamp type
 */
export function getLampTypeDescription(light: LightWithId): string {
  const wattage = getLampWattage(light);

  if (wattage >= 30) return `Ceiling/Pendant Light (${wattage}W)`;
  if (wattage >= 15) return `Lightstrip (${wattage}W)`;
  if (wattage >= 9) return `Standard Bulb (${wattage}W)`;
  if (wattage >= 7) return `Play/Bar (${wattage}W)`;
  return `Spot/Downlight (${wattage}W)`;
}
