// Wall tablet: Chrome on a LAN http origin can't turn the installed app into a
// real fullscreen app (it opens as a normal tab), so the page itself asks for
// fullscreen on the first touch, and again after Chrome drops it (app switch,
// back gesture). Touch screens wider than a phone only, so the PC and the
// Pixel are left alone.
const TABLET_QUERY = '(pointer: coarse) and (min-width: 761px)';

export function setupKioskFullscreen() {
    const root = document.documentElement;
    if (!root.requestFullscreen) return;

    const want = () =>
        window.matchMedia(TABLET_QUERY).matches &&
        !document.fullscreenElement &&
        !window.matchMedia('(display-mode: fullscreen)').matches;

    const enter = () => {
        if (!want()) return;
        root.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    };

    // pointerup counts as a user gesture; capture so no component can swallow it
    window.addEventListener('pointerup', enter, { capture: true });
}
