import { HotspotPlugin } from "../plugins/smoozoo-plugin-hotspot.js";

window.addEventListener('load', async () => {
    const cacheBust = `cb=${Date.now()}`;

    const settings = {
        minimapMaxSize:         200,
        minimapMinSize:         8,
        elasticMoveDuration:    200,
        zoomSmoothing:          0.075,
        inertiaFriction:        0.95,
        inertiaStopThreshold:   0.1,
        canvas:                 document.getElementById('glcanvas'),
        plugins: [
            {
                name:     HotspotPlugin,
                instance: null,
                options: {
                    hotspots: await (await fetch(`./assets/BTCUSDT.json?${cacheBust}`)).json()
                }
            }
        ]
    };

    // smoozoo(`./assets/32k-wide-image.png`, settings);
    // smoozoo(`./assets/xanadu-reconstruction.png`, settings);
    smoozoo(`./assets/BTCUSDT.png?${cacheBust}`, settings);
});
