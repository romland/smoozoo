/**
 * A Smoozoo plugin that creates a shapes overlay from Jonneh's Wurm map viewer data.
 *
 * It relies on the map viewer's `config.js` file, which exposes global `deeds`
 * and `focusZones` arrays. This plugin reads those arrays and converts them into
 * shape objects for Smoozoo to render.
 *
 * For 3D maps (identified by "-3d" in the filename), it uses the `height`
 * property to adjust the shape's Y-position.
 */
import { OverlayBasePlugin } from "./smoozoo-plugin-overlay-base";

export class WurmMapPlugin extends OverlayBasePlugin
{
    static toString() { return "WurmMapPlugin"; }
    static path = "./plugins/smoozoo-plugin-wurm-map.js";

    constructor(api, options, containerElement)
    {
        // Intercept and inject shapes in the constructor.
        options.shapes = WurmMapPlugin.createDeedsAndZones(api.currentImageFilename.includes("-3d") ? "3d" : "flat");
        super(api, options);

        this.api = api;

        /*
        const htmlFragment = `
            <div id="smoozoo-wurm-search-field" class="file-chooser-container" style="position: fixed; top: 15px; left: 180px;">
                <input type="text"/>
            </div>
        `;
        const targetElement = containerElement;
        targetElement.insertAdjacentHTML('beforeend', htmlFragment);
        */

        window.addEventListener('keydown', (e) => this.handleWindowKeyDown(e));
    }

    zoomOut()
    {
        const imgSize = this.api.getImageSize();
        this.api.animateTo({ x: imgSize.width / 2, y: imgSize.height / 2, scale: 0.2, duration: 1500, easing: "easeInOutCubic" });
    }

    /**
     * Let's add two keys (alternatively one could have an always visible search box):
     * f:  Find a deed and go to it, provided we only got one result,
     *     otherwise we will zoom out and drawShape() will take over and
     *     flag multiple results.
     * Escape: Go back to zoomed out view
     */
    handleWindowKeyDown(e)
    {
        switch (e.key) {
            case 'Escape':
                this.query = undefined;
                this.zoomOut();
                super.update();
                break;

            case 'f':
                if (e.ctrlKey) return;
                const query = prompt("Search for deed");
                if (!query) return;

                const hits = this.getShapes().filter(shape => shape.type === "text" && this.isNeedleInHaystack(query, shape.text));

                if (hits.length === 1) {
                    this.query = undefined;
                    this.api.animateTo({ x: hits[0].x, y: hits[0].y, scale: 2, duration: 1500, easing: "easeInOutCubic" });
                } else {
                    this.query = query;
                    this.zoomOut();
                }
                super.update();
                break;
        }
    }

    isNeedleInHaystack(needle, haystack)
    {
        return needle && haystack && haystack.toLocaleLowerCase().includes(needle.toLocaleLowerCase());
    }

    /**
     * If multiple search results: highlight them by brutally overriding drawShape().
     */
    drawShape(shape, isHovered, screenX, screenY)
    {
        if (this.query && shape.type === "text" && (this.isNeedleInHaystack(this.query, shape.text) || this.isNeedleInHaystack(this.query, shape.tooltip))) {
            shape = { ...shape, textBackgroundColor: 'rgba(0, 0, 255, 1)' };
        }
        super.drawShape(shape, isHovered, screenX, screenY);
    }

    /**
     * onImageLoaded() is not called for the initial image as plugins are not instantiated yet.
     */
    onImageLoaded(newUrl)
    {
        const view = newUrl.includes("-3d") ? "3d" : "flat";
        this.setShapes(WurmMapPlugin.createDeedsAndZones(view));
    }

    static createDeedsAndZones(view)
    {
        if (typeof deeds === 'undefined' || typeof focusZones === 'undefined') {
            throw new Error(`This Wurm Map plugin is missing the global 'deeds' or 'focusZones' variables. Please ensure you have included the map viewer's config file, e.g., <script src="config.js"></script>`);
        }
        return [
            ...WurmMapPlugin.convertLocationsToObjects(deeds, true, view),
            ...WurmMapPlugin.convertLocationsToObjects(focusZones, false, view)
        ];
    }

    static convertLocationsToObjects(locs, isDeed = true, view = "flat")
    {
        return locs.flatMap(({ sx, sy, ex, ey, name, height, permanent, x, y }) => {
            const yOffset = view === "3d" ? height / 40 : 0;

            // Rectangle for the hover area and tooltip.
            const rectShape = {
                type: 'rect',
                x: sx,
                y: sy - yOffset,
                width: ex - sx,
                height: ey - sy,
                lineWidth: 1,
                fillStyle: 'rgba(0,0,0,0.2)',
                hover: true,
                tooltip: `${name} (height: ${height})`
            };

            // Text label.
            // Conditional properties below handle styling for focus zones (!isDeed).
            const textShape = {
                type: 'text',
                text: name,
                x: x,
                y: y - yOffset,
                fillStyle: isDeed ? (permanent ? 'gold' : 'white') : 'black',
                font: isDeed && permanent ? '14px sans-serif' : '12px sans-serif',
                textBackgroundColor: isDeed ? 'rgba(0, 0, 0, 0.6)' : 'rgba(255, 0, 0, 1)',
                fixedSize: true
            };

            return [rectShape, textShape];
        });
    }
}

if(!window?.smoozooPlugins)
    window.smoozooPlugins = {};
window.smoozooPlugins["WurmMapPlugin"] = WurmMapPlugin;
