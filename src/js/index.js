import { HotspotPlugin } from "../plugins/smoozoo-plugin-hotspot.js";

window.addEventListener('load', async () => {
    const cacheBust = `cb=${Date.now()}`;

    const settings = {
        minimapMaxSize:         200,
        minimapMinSize:         8,
        elasticMoveDuration:    200,
        zoomSmoothing:          0.075,
        mouseInertiaFriction:   0.95,
        touchInertiaFriction:   0.98,   // A slightly higher value for touch 'flings'
        inertiaStopThreshold:   0.1,
        initialScale:           0.9,
        initialPosition:        { x: 0.5, y: 0.5 },
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

    /*
    // We do not yet support different image sizes, but should be pretty high on TODO.
    const screenWidth = window.screen.width * window.devicePixelRatio;

    if (screenWidth <= 800) {
        imageUrl += '?size=small';
    } else if (screenWidth <= 1600) {
        imageUrl += '?size=medium';
    }
    */


    smoozoo(`./assets/32k-wide-image.png`, settings);
    // smoozoo(`./assets/xanadu-reconstruction.png`, settings);
    // smoozoo(`./assets/ignoreBlackMarble_2016_928m_mediterranean_labeled.png`, settings);
    // smoozoo(`./assets/BTCUSDT.png?${cacheBust}`, settings);
});
