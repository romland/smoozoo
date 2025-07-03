## This is Smoozoo
A super-smooth, performant and modern image viewer for the web.  
Made for very large images that require fast navigation and scaling.  

### Bigger Features
- Sexy and feels nice
- GPU scaling using WebGL with mipmapping and frustum culling
- No third party dependencies

### Other features
- Minimap navigator
- Kinetic/inertial/elastic transforming/scaling
- Plugin support

### About
For a different project I needed something that felt smooth and worked
very well with huge images in a web browser. So, Smoozoo was born, but was
initially quite modest, using just a plain 2d canvas. It was never meant to
be a separate project, but as you can imagine with huge images: it was
obnoxiously slow if wanting good navigation and scaling, sooo, here we are.

You'll be surprised how much code is needed to make a user experience that
feels this way. I know I am.

The feel is inspired by Windows 10/11's default image viewer. Not quite done
yet, but, Smoozoo actually already feels _better_ than Windows native one!


### Help
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


### TODO
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
