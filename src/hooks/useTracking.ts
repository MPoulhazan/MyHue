import { useEffect, useRef } from 'react';
import type { LightWithId } from '../types/hue';
import { trackingService } from '../services/trackingService';

/**
 * Hook to automatically track light state changes
 * Compares previous and current states and records changes
 */
export const useTracking = (lights: LightWithId[]) => {
  const previousStatesRef = useRef<Map<string, boolean>>(new Map());

  useEffect(() => {
    // Check each light for state changes
    lights.forEach(light => {
      const previousState = previousStatesRef.current.get(light.id);
      const currentState = light.state.on;

      // If this is the first time we see this light, initialize it
      if (previousState === undefined) {
        previousStatesRef.current.set(light.id, currentState);
        // Record initial state
        trackingService.recordStateChange(light);
      }
      // If state changed, record it
      else if (previousState !== currentState) {
        console.log(`Light ${light.name} changed from ${previousState} to ${currentState}`);
        trackingService.recordStateChange(light);
        previousStatesRef.current.set(light.id, currentState);
      }
    });
  }, [lights]);

  return {
    recordManualChange: (light: LightWithId) => {
      trackingService.recordStateChange(light);
      previousStatesRef.current.set(light.id, light.state.on);
    },
  };
};
