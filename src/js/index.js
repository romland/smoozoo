import { HotspotPlugin } from "../plugins/smoozoo-plugin-hotspot.js";
import { OverlayBasePlugin } from "../plugins/smoozoo-plugin-overlay-base.js";
import { MinimapPlugin } from "../plugins/smoozoo-plugin-minimap.js";
import { FileChooserPlugin } from "../plugins/smoozoo-plugin-filechooser.js";

window.addEventListener('load', async () => {
    const settings = {
        canvas:                     document.getElementById('glcanvas'),
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
        plugins: [
            {
                name: HotspotPlugin,
                options: {
                    // Ah, a bit of ugliness to get Parcel to pick up the asset.
                    hotspots: await (await fetch( new URL(`../assets/ETHUSDT-ath.json`, import.meta.url).toString() )).json(),
                    objectType: "ATHs"
                }
            },
            {
                name: OverlayBasePlugin,
                options: {
                }
            },
            {
                name: MinimapPlugin,
                options: {
                    minimapMinSize: 0,
                    minimapMaxSize: 200
                }
            },
            {
                name: FileChooserPlugin,
                options: {
                    allowFileDrop: true,
                    showFileList: true,
                    showFileDialog: true,
                    presetFiles: [
                        { name: 'Xanadu (reconstructed game world)',  url: new URL(`../assets/xanadu-reconstruction.png`, import.meta.url).toString() },
                        { name: 'Arathok test-map',  url: new URL(`../assets/ara-map.png`, import.meta.url).toString() },
                        { name: 'BTC-USDT', url: new URL(`../assets/BTCUSDT.png`, import.meta.url).toString() },
                        { name: 'ETH-USDT all-time-highs', url: new URL(`../assets/ETHUSDT-ath.png`, import.meta.url).toString() },
                        { name: 'BTC-USDT all-time-highs', url: new URL(`../assets/BTCUSDT-ath.png`, import.meta.url).toString() },
                    ]
                }
            },
        ]
    };

    const url = new URL(`../assets/ETHUSDT-ath.png`, import.meta.url);
    smoozoo(url.toString(), settings);
});
