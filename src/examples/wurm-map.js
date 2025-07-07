import { MinimapPlugin } from "../plugins/smoozoo-plugin-minimap.js";
import { FileChooserPlugin } from "../plugins/smoozoo-plugin-filechooser.js";
import { WurmMapPlugin } from "../plugins/smoozoo-plugin-wurm-map.js";

window.addEventListener('load', async () => {
    const settings = {
        canvas:                     document.getElementById('smoozoo-glcanvas'),
        backgroundColor:            "#373e71",
        initialScale:               0.3,
        initialPosition:            { x: 0.0, y: 0.5 },
        loadingAnimation:           false,
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
                name: MinimapPlugin,
                options: {
                    minimapMinSize: 0,
                    minimapMaxSize: 200
                }
            },
            {
                name: FileChooserPlugin,
                options: {
                    allowFileDrop: false,
                    showFileList: true,
                    showFileDialog: false,
                    presetFiles: [
                        { name: 'Zenath PvE',  url: new URL(`../assets/zenath-pve.png`, import.meta.url).toString() },
                        { name: 'Zenath PvE 3D',  url: new URL(`../assets/zenath-pve-3d.png`, import.meta.url).toString() },
                        { name: 'Zenath PvE roads',  url: new URL(`../assets/zenath-pve-road.png`, import.meta.url).toString() },
                    ],
                    strings: {
                        "Select..." : "View"
                    }
                },
            },
            {
                name: WurmMapPlugin,
                options: {
                    minimapMinSize: 0,
                    minimapMaxSize: 200
                }
            },
        ]
    };

    // Let's abuse FileChooser: Load first image in presetFiles
    smoozoo(settings.plugins[1].options.presetFiles[0].url, settings);
});
