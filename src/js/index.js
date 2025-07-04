import { HotspotPlugin } from "../plugins/smoozoo-plugin-hotspot.js";

window.addEventListener('load', async () => {
    const settings = {
        minimapMaxSize:         200,
        minimapMinSize:         8,
        elasticMoveDuration:    200,
        zoomSmoothing:          0.075,
        mouseInertiaFriction:   0.95,
        touchInertiaFriction:   0.98,
        inertiaStopThreshold:   0.1,
        initialScale:           0.9,
        initialPosition:        { x: 0.5, y: 0.5 },
        pixelatedZoom:          true,
        canvas:                 document.getElementById('glcanvas'),
        /*
        plugins: [
            {
                name:     HotspotPlugin,
                instance: null,
                options: {
                    hotspots: await (await fetch(`./assets/BTCUSDT.json?${cacheBust}`)).json()
                }
            }
        ]
        */
    };

    const url = new URL(`../assets/xanadu-reconstruction.png`, import.meta.url);
    // const url = new URL(`../assets/ignoreBlackMarble_2016_928m_mediterranean_labeled.png`, import.meta.url);
    // const url = new URL(`../assets/BTCUSDT.png`, import.meta.url);
    // const url = new URL(`../assets/32k-wide-image.png`, import.meta.url);

    console.log("Loading image", url.toString(), "...");
    smoozoo(url.toString(), settings);
});
