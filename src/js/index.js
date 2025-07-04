import { HotspotPlugin } from "../plugins/smoozoo-plugin-hotspot.js";

// This is Parcel hackery so that it's included in the build
// import externalJsonFile from 'url://./src/assets/ETHUSDT-ath.json';

window.addEventListener('load', async () => {
    const settings = {
        minimapMaxSize:             200,
        minimapMinSize:             8,
        elasticMoveDuration:        200,
        zoomSmoothing:              0.075,
        mouseInertiaFriction:       0.95,
        touchInertiaFriction:       0.98,
        inertiaStopThreshold:       0.1,
        initialScale:               0.3,
        initialPosition:            { x: 0.0, y: 0.5 },
        allowDeepLinks:             true,
        pixelatedZoom:              true,
        dynamicTextureFiltering:    true,
        dynamicFilteringThreshold:  2.0,
        canvas:                     document.getElementById('glcanvas'),
        plugins: [
            {
                name:     HotspotPlugin,
                instance: null,
                options: {
                    // Ah, a bit of ugliness to get Parcel to pick up the asset.
                    hotspots: await (await fetch( new URL(`../assets/ETHUSDT-ath.json`, import.meta.url).toString() )).json(),
                    objectType: "ATHs"
                }
            }
        ]
    };

    // const url = new URL(`../assets/xanadu-reconstruction.png`, import.meta.url);
    // const url = new URL(`../assets/BTCUSDT.png`, import.meta.url);
    const url = new URL(`../assets/ETHUSDT-ath.png`, import.meta.url);

    console.log("Loading image", url.toString(), "...");
    smoozoo(url.toString(), settings);
});
