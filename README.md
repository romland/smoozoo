## This is Smoozoo
A super-smooth, performant and modern image viewer for the web.  
Made for very large images that require fast navigation and scaling.  

### Bigger features
- Sexy look and feel
- GPU scaling using WebGL with mipmapping and frustum culling
- No third party dependencies

### Other features
- Plain Javascript, no nonsense (hi Giel)
- Minimap navigator
- Plugin support
- Desktop-first but very mobile-friendly

### About
I originally built Smoozoo (it did not have a name) for another project 
using a basic 2D canvas and simple scaling — it started small and wasn’t
meant to become a ... project, but handling large images quickly became
painfully slow. And now we're here.

You'll be surprised how much code is needed to make a user experience that
feels this way. I know I am.

The feel is inspired by Windows 10/11's default image viewer. We're not
quite done yet, but, this actually already feels _better_ than Windows
native one (I humbly opine)!

### Help on use
- Keyboard
    - `Home`  
        Quickly go to left part of image  
    - `End`  
        Quickly go to right  
    - `Page Up`  
        Quickly go to top  
    - `Page Down`  
        Quickly go to bottom  
    - `m`  
        Toggle UI visibility  

- Mouse  
    - `Double-click with a mouse`  
        quickly toggle scale of 0.25 or 1.  
    - `Mousewheel`  
        Quickly zoom in/out  
    - `Left mouse button`  
        Drag to pan image  
    - `Left mouse button on marker/circle`  
        Sticky the popup  

- Navigation misc  
    - `Slider`  
        Sideway navigation only  
    - `Minimap`  
        Use mouse to move viewport horizontally and vertically (depending on zoom level)  


## TODO
	- FIX (or ditch): 'r' to rotate image in steps of 90 degrees
	- we lose all state variables of position/scale if window size changes which is 
	  particularly annoying if you are in fullscreen and accidentally show the browser
	  url/navigation bar.

	- we already support some meta-data via plugin but I'd like to extend that so that
      depending on position of viewport it should show/pin messages to that pixel as we
      pan/zoom around it

    - be able to set a title of an image (through some meta data)

	- Visual Bug: Jarring "Snap" at the End of a Zoom
	  seems to have made "stay at fixed pixel under pointer when zooming" a bit worse -- if I zoom in
	  very fast, it loses track of where I am zooming to. Maybe there needs to be some kind of prediction
	  or so? Not sure what is wrong

    - not for in here, but I would like chartjs to generate base64-encoded images for the
      inline'd minute-charts

    - Check screenwidth and decide based on that if we should load a smaller version of the image.

    - Change cursor to grab by default, when panning: grabbing

    - drag/drop image / filepicker

    - smart conversion of image to dark mode / brightness / contrast / saturation

    - annotation on a separate canvas

    - "Tiled pyramid" format (like DZI - Deep Zoom Image). Support for pre-sliced tiles at
      different scales from back-end (low priority as it needs server side code).

    - Let Smoozoo create its own HTML elements instead of requiring all those HTML tags; 
      we just want to pass in a container to Smoozoo.

## Use in your own projects
See `index.html` on what elements are needed.

Then start Smoozoo like this:
```javascript
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
        canvas:                 document.getElementById('glcanvas'),
        plugins: [
            // any plugins you might have -- see below for more information.
        ]
    };

    // URL object is used so that Parcel can easily find the asset.
    const url = new URL(`../assets/some-image.png`, import.meta.url);
    smoozoo(url.toString(), settings);
});
```


## Plugins
Support is very sparse at the moment, it was expanded with what I needed, as I needed it.

Your plugin consists of two files (or one if no css), include them in your HTML page:
```html
<script type="module" src="./plugins/smoozoo-plugin-yours.js"></script>
<link rel="stylesheet" href="./plugins/smoozoo-plugin-yours.css" />
```

The .js file should export a class which will be instantiated by Smoozoo on startup.

For example:
```javascript
export class YourSmoozooPlugin
{
    /**
     * viewer 
     * is your proxy to the API of Smoozoo
     * 
     * options
     * is an object you pass in via settings when you instantiate Smoozoo
     */
    constructor(viewer, options)
    {
        // ... your code
    }
}
```

So, to make it all come together. When you configure Smoozoo, give it your plugin.

Like so:
```javascript
import { YourSmoozooPlugin } from "../plugins/smoozoo-plugin-yours.js";

const settings = {
    ...other smoozoo settings here...,
    plugins: [
        {
            name:     YourSmoozooPlugin,
            instance: null,
            options: {
                anything: await (await fetch(`./assets/BTCUSDT.json`)).json(),
                youwant: true,
                goes: "here",
            }
        }
    ]
};

const url = new URL(`../assets/some-image.png`, import.meta.url);
smoozoo(url.toString(), settings);
```

### Plugin API
This is the API you get access via `viewer` in your plugin. As stated before, it is
very sparse at the moment. More will come as needed, feel free to expand it.

This is how the API that is passed to plugins is instantiated at the moment:
```javascript
    const viewerApi = {
        getTransform: () => ({ scale, originX, originY }),
        getCanvas: () => canvas,
        requestRender: render
    };
```
