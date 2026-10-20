// Xiaomi/Aqara sensors are now handled entirely via Zigbee (zigbeeService.js).
// This module is kept as a thin compatibility shim.

export const isConfigured = () => true;

export const isLoggedIn = () => true;

export const getAuthStatus = () => ({
    configured: true,
    loggedIn: true,
    loginInProgress: false,
});

export const startLogin = async () => ({ status: 'ok' });

export const getDevices = async () => [];

export const getSensorsWithData = async () => [];

export const logout = () => {};
