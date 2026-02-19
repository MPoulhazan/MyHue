import axios from 'axios';
import * as castService from './castService.js';

const EUREKA_TIMEOUT = 2000;

const fetchEurekaInfo = async (host) => {
    try {
        const response = await axios.get(`http://${host}:8008/setup/eureka_info`, {
            timeout: EUREKA_TIMEOUT,
            params: { options: 'detail' },
        });
        return response.data;
    } catch {
        return null;
    }
};

const formatUptime = (seconds) => {
    if (!seconds || seconds <= 0) return null;
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}j ${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
};

const parseDeviceInfo = (castDevice, eureka) => {
    const info = {
        id: castDevice.id,
        name: castDevice.name,
        host: castDevice.host,
        port: castDevice.port,
        manual: castDevice.manual || false,
        online: false,
        eureka: null,
    };

    if (!eureka) return info;

    info.online = true;
    info.eureka = {
        name: eureka.name || castDevice.name,
        buildVersion: eureka.build_version || null,
        castBuildRevision: eureka.cast_build_revision || null,
        model: eureka.detail?.model_name || null,
        manufacturer: eureka.detail?.manufacturer || null,
        hardwareVersion: eureka.detail?.hardware_version || null,
        locale: eureka.locale?.display_string || eureka.locale || null,
        timezone: eureka.timezone || null,
        uptime: formatUptime(eureka.uptime),
        uptimeSeconds: eureka.uptime || null,
        ssid: eureka.ssid || null,
        signalLevel: eureka.signal_level != null ? eureka.signal_level : null,
        noiseLevel: eureka.noise_level != null ? eureka.noise_level : null,
        ipAddress: eureka.ip_address || castDevice.host,
        macAddress: eureka.mac_address || null,
        publicKey: null, // skip sensitive data
    };

    return info;
};

export const getGoogleHomeDevices = async () => {
    const castDevices = castService.getDevices();

    const results = await Promise.allSettled(
        castDevices.map(async (device) => {
            const eureka = await fetchEurekaInfo(device.host);
            return parseDeviceInfo(device, eureka);
        })
    );

    return results
        .filter(r => r.status === 'fulfilled')
        .map(r => r.value);
};
