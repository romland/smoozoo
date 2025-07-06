/**
 * A class that extends the Shapes Overlay base!
 * 
 * This depends on Jonneh's Wurm mapviewer config file to be included as a script on the page.
 * 
 * ...and well, instantiate this plugin in Smoozoo and ... that's it.
 * 
 * Background
 * ----------
 * Jonneh's mapviewer that we are trying to have compatibility with thankfully just 
 * put two variables in the global/window scope: deeds and focusZones.
 * 
 * Let's grab them and convert them to objects Smoozoo can understand.
 * 
 * Jonneh's mapviewer define a deed like this:
 *   this.name
 *   this.x
 *   this.y
 *   this.sx
 *   this.sy
 *   this.ex
 *   this.ey
 *   this.height
 *   this.permanent
 * 
 * And a focusZone like this:
 *   this.name = name;
 *   this.x = x;
 *   this.y = y;
 *   this.sx = sx;
 *   this.sy = sy;
 *   this.ex = ex;
 *   this.ey = ey;
 *   this.height = height;
 *   this.type = type;
 * 
 * The only special thing in the shapes conversion is the height. We use it to adjust
 * our Y-pos depending on the height of the object.
 * 
 * There are two very rudimentary checks for whether we are displaying a 3D map or not;
 * if the filename contains "-3d", we deem it being a 3D view. This obviously should
 * be more robust if serious.
 */
import { OverlayBasePlugin } from "./smoozoo-plugin-overlay-base";

export class WurmMapPlugin extends OverlayBasePlugin
{
    constructor(api, options)
    {
        options.shapes = WurmMapPlugin.createDeedsAndZones(api.currentImageFilename.includes("-3d") ? "3d" : "flat");

        super(api, options);
    }

    // onImageLoaded() is not called for the initial image as plugins are not instantiated yet.
    onImageLoaded(newUrl)
    {
        this.setShapes(WurmMapPlugin.createDeedsAndZones(newUrl.includes("-3d") ? "3d" : "flat"));
    }

    static createDeedsAndZones(view)
    {
        let shapes = []
        shapes = shapes.concat(WurmMapPlugin.convertLocationsToObjects(deeds, true, view));
        shapes = shapes.concat(WurmMapPlugin.convertLocationsToObjects(focusZones, false, view));
        return shapes;
    }

    static convertLocationsToObjects(locs, isDeed = true, view = "flat")
    {
        return locs.flatMap(location => {
            // Rectangle for the hover area and tooltip.
            const rectShape = {
                type: 'rect',
                x: location.sx,
                y: location.sy,
                width: location.ex - location.sx,
                height: location.ey - location.sy,
                lineWidth: 1,
                fillStyle: 'rgba(0,0,0,0.2',
                hover: true,
                tooltip: location.name + " (height: " + location.height + ")"
            };

            // Text label.
            const textShape = {
                type: 'text',
                text: location.name,
                x: location.x, // Center the text using the main x/y coordinates
                y: location.y,
                // Style permanent locations differently to make them stand out
                fillStyle: location.permanent ? 'gold' : 'white',
                font: location.permanent ? '14px sans-serif' : '12px sans-serif',
                textBackgroundColor: 'rgba(0, 0, 0, 0.6)',
                fixedSize: true // Keep labels readable at any zoom level
            };

            // This should only happen for focus zones.
            if(!isDeed) {
                textShape.textBackgroundColor = 'rgba(255, 0, 0, 1)';
                textShape.fillStyle = "black";
            }

            if(view === "3d") {
                rectShape.y -= location.height / 40;
                textShape.y -= location.height / 40;
            }

            return [rectShape, textShape];
        });
    }
}
