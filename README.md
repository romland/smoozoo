## ✨ This is Smoozoo
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

![Mobile screenshot](/.github/mobile-screenshot.png?raw=true "Mobile Screenshot")

### Usage
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

- Mobile
    - `Single tap`  
        Toggle visibility of UI  
    - `Pinch`  
        Zoom  
    - `Flick`  
        Moves with a glide
    - `Move`  
        Pan

- Navigation misc  
    - `Slider`  
        Sideway navigation only (useful for very wide and not very tall images)  
    - `Minimap`  
        Use mouse/finger on minimap to move viewport in all directions (depending on zoom level)  

### Demo
For some odd reason, Smoozoo is a lot smoother in Firefox than in Chrome. That's good!  

https://oobabooga.com/smoozoo/  

Note: it's a very low-end host, image will take a few seconds to load.

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

## TODO
    - I think I introduced some zoom-jitter when attempting a fix to stay locked
      on a pixel when animating in/out zoom

    - There seems to be some kind of acceleration/momentum issue when you flick
      the view with mouse. Perhaps it happens when you flick and we are already
      gliding?

    - Let Smoozoo create its own HTML elements instead of requiring all those HTML tags; 
      we just want to pass in a container to Smoozoo.
    
    - Code is in one large file now. It used to be a small file. Split things up a bit.
      Although personally, I am a fan of a single large file!

    - FIX (or ditch): 'r' to rotate image in steps of 90 degrees

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
        pixelatedZoom:          false,
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
The breadth of the API is very sparse at the moment, it was expanded with what I needed,
as I needed it. 

That said ...

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

    /**
     * Called by Smoozoo on every render(), and 
     * once right after instantiating the plugin.
     */
    update()
    {
    }

    /**
     * Called when mouse moves over canvas
     */
    onMouseMove(e)
    {
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
            name:    YourSmoozooPlugin,
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
This is the API you get access to via `viewer` in your plugin's constructor. As
stated before, it is very sparse at the moment. More will come as needed, feel
free to expand it.

This is how the API that is passed to plugins is instantiated at the moment:
```javascript
    const viewerApi = {
        getTransform: () => ({ scale, originX, originY }),
        getCanvas: () => canvas,
        requestRender: render
    };
```

## Existing plugins
At the moment I only made one.

### Hotspot plugin
This enables associating additional information in a popup with a pixel position in the underlying image.  

E.g. with a radius of 20 at position 150,210, show this popup when hovered.  

It supports clustering so that, e.g. 100 markers will become one if zoomed out.  

Enable it in settings:
```javascript
    const settings = {
        ...,
        plugins: [
            {
                name:     HotspotPlugin,
                instance: null,
                options: {
                    // A bit of ugliness to get Parcel to pick up the asset.
                    hotspots: await (await fetch( new URL(`../assets/ETHUSDT-ath.json`, import.meta.url).toString() )).json(),
                    objectType: "ATHs"  // Just a name of your choice, can be left empty too
                }
            }
        ]
    }
```

The format of the `JSON` is this:

```json
[
    {
        "id": "at-1746277307000",
        "x": 1358,
        "y": 1060,
        "radius": 2,
        "content": {
            "title": "Some title",
            "subtitle": "actually shows up in footer of popup",
            "text": "text content of popup",
            "image": null
        }
    },
    ... more entries ...
]
```


## Maybe TODO
    - "Tiled pyramid" format (like DZI - Deep Zoom Image). Support for pre-sliced tiles at
      different scales from back-end (low priority as it needs server side code).

    - Check screenwidth and decide based on that if we should load a smaller version of the image.
      (would need server-side code, not currently interested)


## Maybe future plugins
    - smart conversion of image to dark mode
    
    - ability to set brightness / contrast / saturation - maybe other adjustments

    - not for in here, but I would like chartjs to generate base64-encoded images for the
      inline'd minute-charts

    - annotation on a separate canvas

	- we already support some meta-data via plugin but I'd like to extend that so that
      depending on position of viewport it should show/pin messages to that pixel as we
      pan/zoom around it

    - be able to set a title of an image (through some meta data)

    - get rid of slider and just use minimap? Or possibly, only show slider when we have
      really wide images?

    - save image; incl. whatever plugins did -- would need some way to say which elements
      are part of the image (in the case of overlay canvases and similar.

    - drag/drop image / filepicker
