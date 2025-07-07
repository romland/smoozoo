import { MinimapPlugin } from "../plugins/smoozoo-plugin-minimap.js";
import { FileChooserPlugin } from "../plugins/smoozoo-plugin-filechooser.js";
import { HotspotPlugin } from "../plugins/smoozoo-plugin-hotspot.js";
import { OverlayBasePlugin } from "../plugins/smoozoo-plugin-overlay-base.js";

window.addEventListener('load', async () => {
    const settings = {
        canvas:                     document.getElementById('smoozoo-glcanvas'),
        backgroundColor:            "#0e0422",
        initialScale:               0.3,
        initialPosition:            { x: 0.0, y: 0.5 },
        loadingAnimation:           true,
        maxScale:                   40,
        elasticMoveDuration:        200,
        zoomSmoothing:              0.075,
        mouseInertiaFriction:       0.95,
        touchInertiaFriction:       0.98,
        inertiaStopThreshold:       0.1,
        allowDeepLinks:             true,   // Allow going to e.g. ?x=2777&y=1879&scale=20.000000
        pixelatedZoom:              true,   // Can also be toggled with p, or overridden with dynamic below
        dynamicFilteringThreshold:  2.0,    // The scale where we toggle filtering (if enabled)
        dynamicTextureFiltering:    true,   // If greater or less than dynamicFilteringThreshold,
                                            // automatically toggle texture filtering (pixelated or not)
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
                    hoverOutlineColor: "yellow",
                    defaultTextFontSize: 14,
                    defaultTextFontFamily: "sans-serif",
                    defaultTextFontColor: "#888",
                    defaultTextBackground: undefined,
                    // An explicit `null` instead of an array below will show some default test shapes
                    shapes: [            {
                        // https://getemoji.com/
                        type: 'text',
                        x: 1600, y: 700,
                        fillStyle: 'yellow',
                        font: '178px sans-serif',
                        text: "🧐",
                        tooltip: "",
                    },
                ],
                }
            },
            {
                name: FileChooserPlugin,
                options: {
                    allowFileDrop: true,
                    showFileList: true,
                    showFileDialog: true,
                    presetFiles: [
                        { name: 'BTC-USDT', url: new URL(`../assets/BTCUSDT.png`, import.meta.url).toString() },
                        { name: 'ETH-USDT all-time-highs', url: new URL(`../assets/ETHUSDT-ath.png`, import.meta.url).toString() },
                        { name: 'BTC-USDT all-time-highs', url: new URL(`../assets/BTCUSDT-ath.png`, import.meta.url).toString() },

                        { name: 'Xanadu (reconstructed game world)',  url: new URL(`../assets/xanadu-reconstruction.png`, import.meta.url).toString() },
                        { name: 'Arathok test-map',  url: new URL(`../assets/ara-map.png`, import.meta.url).toString() },
                    ],
                }
            },
            {
                name: MinimapPlugin,
                options: {
                    minimapMinSize: 0,
                    minimapMaxSize: 200
                }
            },
        ]
    };

    const url = new URL(`../assets/ETHUSDT-ath.png`, import.meta.url);
    smoozoo(url.toString(), settings);
});
