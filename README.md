## This is Smoozoo
A super-smooth, performant and modern image viewer for the web.  
Made for very large images that require fast navigation and scaling.

### Major Features
- Sexy
- WebGL
- GPU scaling with mipmapping and frustum culling
- No dependencies
- ...

### Other features
- Kinetic/inertial/elastic panning
- Minimap navigator
- Plugin support
- ...

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
	- FIX: 'r' to rotate image in steps of 90 degrees
	- we lose all state variables of position/scale if window size changes which is 
	  particularly annoying if you are in fullscreen and accidentally show the browser
	  url/navigation bar.

	- would be nice with some interactivity so that i can associate some pixels/circle/point w/ radius
	  with, on hover, showing more information (e.g. tweet on a chart). There would need to be a meta
	  data array next to this all that associates a point+radius with entries in that data structure.
	  I would like to be able to display text and/or picture on hover. I am not sure what is most efficient,
	  doing it all on canvas or just listen for position in html and show a html "popup" around the area?

	- also in the same vein, depending on position of original (that is in view) it should show/pin 
	  messages to that pixel as we pan/zoom around it

	- 3. (Visual Bug) Jarring "Snap" at the End of a Zoom
	  seems to have made "stay at fixed pixel under pointer when zooming" a bit worse -- if I zoom in
	  very fast, it loses track of where I am zooming to. Maybe there needs to be some kind of prediction
	  or so? Not sure what is wrong myself

    - not for in here, but I would like chartjs to generate base64-encoded images for the
      inline'd minute-charts
