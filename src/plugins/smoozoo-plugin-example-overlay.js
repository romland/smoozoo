/**
 * OverlayPlugin
 * 
 * Creates a canvas overlay for drawing that pans and zooms with the main image.
 */
export class ExampleOverlayPlugin
{
    /**
     * @param {object} viewerApi - The API provided by the smoozoo viewer.
     * @param {object} options - Configuration options for this plugin.
     */
    constructor(viewerApi, options)
    {
        this.viewerApi = viewerApi;
        this.options = options || {};

        // Get the main canvas from the viewer
        this.mainCanvas = this.viewerApi.getCanvas();
        
        // Create the overlay canvas
        this.overlayCanvas = document.createElement('canvas');
        this.ctx = this.overlayCanvas.getContext('2d');

        // Append the overlay canvas to the same parent as the main canvas
        this.mainCanvas.parentNode.appendChild(this.overlayCanvas);

        // Style the overlay to sit perfectly on top of the main canvas
        this.overlayCanvas.style.position = 'absolute';
        this.overlayCanvas.style.top = this.mainCanvas.offsetTop + 'px';
        this.overlayCanvas.style.left = this.mainCanvas.offsetLeft + 'px';

        // We set pointerEvents to 'none' so that mouse events for panning/zooming
        // are received by the main canvas. We will handle hover detection using the
        // onMouseMove hook provided by the viewer API, which is more robust.
        this.overlayCanvas.style.pointerEvents = 'none';

        // Shape data
        // Store shape information in an array for easy management and hit detection.
        // You likely want to load this in dynamically via a fetch() or so
        this.shapes = [
            {
                id: 'circle1',
                type: 'circle',
                x: 500, y: 500, radius: 50,
                fillStyle: 'rgba(255, 0, 0, 0.5)',
                tooltip: 'Red Circle - An important area.'
            },
            {
                id: 'rect1',
                type: 'rect',
                x: 800, y: 400, width: 150, height: 100,
                fillStyle: 'rgba(0, 100, 255, 0.5)',
                strokeStyle: 'black',
                lineWidth: 4,
                tooltip: 'Blue Rectangle - A clickable zone.'
            },
            {
                id: 'text1',
                type: 'text',
                x: 500, y: 700,
                fillStyle: 'yellow',
                font: '48px sans-serif',
                text: 'Hello from Example Plugin!',
                tooltip: 'This is a text label.'
            }
        ];
        this.hoveredShape = null;

        // Ensure the overlay canvas always has the same size as the main canvas
        this.resizeObserver = new ResizeObserver(() => {
            this.overlayCanvas.width = this.mainCanvas.clientWidth;
            this.overlayCanvas.height = this.mainCanvas.clientHeight;
            this.viewerApi.requestRender(); // Request a redraw after resize
        });
        this.resizeObserver.observe(this.mainCanvas);

        // Initial size setup
        this.overlayCanvas.width = this.mainCanvas.clientWidth;
        this.overlayCanvas.height = this.mainCanvas.clientHeight;
        
        console.log("OverlayPlugin initialized");
    }

    /**
     * update() is called on every frame by the viewer's render loop.
     */
    update() {
        const { scale, originX, originY } = this.viewerApi.getTransform();

        // 1. Reset the transform to the identity matrix. This ensures that
        //    clearRect operates in the screen's coordinate space, not the
        //    transformed space from the previous frame.
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);

        // 2. Now that the transform is reset, clear the entire canvas.
        this.ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
        
        // 3. Apply the new pan/zoom transform for the current frame's drawing.
        this.ctx.setTransform(scale, 0, 0, scale, originX * scale, originY * scale);
        
        // Draw all shapes
        this.shapes.forEach(shape => {
            this.ctx.save();

            // Apply shape-specific styles
            this.ctx.fillStyle = shape.fillStyle;
            this.ctx.strokeStyle = shape.strokeStyle || 'transparent';
            this.ctx.lineWidth = shape.lineWidth || 1;
            this.ctx.font = shape.font;

            // Draw the shape based on its type
            switch (shape.type) {
                case 'circle':
                    this.ctx.beginPath();
                    this.ctx.arc(shape.x, shape.y, shape.radius, 0, Math.PI * 2);
                    this.ctx.fill();
                    this.ctx.stroke();
                    break;

                case 'rect':
                    this.ctx.fillRect(shape.x, shape.y, shape.width, shape.height);
                    this.ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
                    break;

                case 'text':
                     this.ctx.fillText(shape.text, shape.x, shape.y);
                     break;
            }

            // Draw hover highlight
            if (this.hoveredShape === shape) {
                this.ctx.strokeStyle = 'yellow';
                this.ctx.lineWidth = 6;

                // Redraw the path for the stroke
                switch (shape.type) {
                    case 'circle':
                        this.ctx.beginPath();
                        this.ctx.arc(shape.x, shape.y, shape.radius, 0, Math.PI * 2);
                        this.ctx.stroke();
                        break;

                    case 'rect':
                        this.ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
                        break;
                }
            }

            this.ctx.restore();
        });

        // Draw tooltip
        if (this.hoveredShape) {
            this.drawTooltip(this.hoveredShape);
        }
    }

    /**
     * onMouseMove is called by the viewer when the mouse moves over the main canvas.
     * This is where we perform our hit detection.
     */
    onMouseMove(e) {
        const { scale, originX, originY } = this.viewerApi.getTransform();
        const imageX = (e.clientX / scale) - originX;
        const imageY = (e.clientY / scale) - originY;

        let currentlyHovered = null;

        // Iterate backwards so shapes drawn on top are checked first.
        for (let i = this.shapes.length - 1; i >= 0; i--) {
            const shape = this.shapes[i];
            if (this.isPointInShape(imageX, imageY, shape)) {
                currentlyHovered = shape;
                break;
            }
        }

        // If the hover state has changed, update it and request a re-render.
        if (this.hoveredShape !== currentlyHovered) {
            this.hoveredShape = currentlyHovered;
            this.viewerApi.requestRender();
        }
    }

    /**
     * Checks if a given point (in world coordinates) is inside a shape.
     */
    isPointInShape(x, y, shape)
    {
        switch (shape.type) {
            case 'rect':
                return x >= shape.x && x <= shape.x + shape.width &&
                       y >= shape.y && y <= shape.y + shape.height;

            case 'circle':
                const distance = Math.sqrt(Math.pow(x - shape.x, 2) + Math.pow(y - shape.y, 2));
                return distance <= shape.radius;

            case 'text':
                 // Simple bounding box for text is tricky. For this example, we'll skip it.
                 // A real implementation would measure text width and height.
                return false;

            default:
                return false;
        }
    }


    /**
     * Draws a tooltip for a given shape.
     */
    drawTooltip(shape)
    {
        const { scale } = this.viewerApi.getTransform();
        
        // Make font size smaller as you zoom out, but with a minimum size.
        // This makes the tooltip readable at different zoom levels.
        const fontSize = Math.max(12, 24 / scale);
        this.ctx.font = `${fontSize}px sans-serif`;
        
        const textMetrics = this.ctx.measureText(shape.tooltip);
        const textWidth = textMetrics.width;
        const textHeight = fontSize; // Approximate height

        const padding = 10 / scale;
        const boxWidth = textWidth + padding * 2;
        const boxHeight = textHeight + padding * 2;
        
        // Position the tooltip above the shape
        const boxX = (shape.x + (shape.width || 0) / 2) - (boxWidth / 2);
        const boxY = shape.y - boxHeight - (20 / scale);

        // Draw the tooltip box
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        this.ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

        // Draw the tooltip text
        this.ctx.fillStyle = 'white';
        this.ctx.fillText(shape.tooltip, boxX + padding, boxY + textHeight + padding / 2);
    }
    

    // TODO: I need to call this? I need a destroy() in viewer too.
    destroy()
    {
        this.resizeObserver.disconnect();
        this.overlayCanvas.remove();
    }
}
