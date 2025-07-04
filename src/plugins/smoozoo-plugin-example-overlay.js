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
                type: 'circle',
                x: 500, y: 500, radius: 50,
                fillStyle: 'rgba(255, 0, 0, 0.5)',
                tooltip: 'Red Circle - An important area.'
            },
            {
                type: 'rect',
                x: 800, y: 400, width: 150, height: 100,
                fillStyle: 'rgba(0, 100, 255, 0.5)',
                strokeStyle: 'black',
                lineWidth: 4,
                tooltip: 'Blue Rectangle - A clickable zone.'
            },
            {
                id: 'rect1',
                type: 'rect',
                x: 400, y: 400, width: 200, height: 50,
                fillStyle: 'rgba(120, 100, 255, 0.5)',
                strokeStyle: 'pink',
                lineWidth: 4,
                tooltip: 'This rectangle has a shadow!',
                // Arbitrary commands passed to Canvas before drawing
                beforeDraw: [
                    { "prop": "shadowColor", "value": "rgba(0, 0, 0, 0.5)" },
                    { "prop": "shadowBlur", "value": 15 },
                    { "prop": "shadowOffsetX", "value": 10 },
                    { "prop": "shadowOffsetY", "value": 10 }
                ]
            },
            {
                type: 'text',
                x: 600, y: 600,
                fillStyle: 'yellow',
                font: '48px sans-serif',
                text: '!',
                tooltip: 'This is a resizable text label.',
            },
            {
                type: 'text',
                x: 500, y: 700,
                fillStyle: 'white',
                font: '10px sans-serif',
                text: 'Hello from Example Plugin!',
                tooltip: 'This is a fixed size text label.',
                fixedSize: true
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
    update()
    {
        const { scale, originX, originY } = this.viewerApi.getTransform();

        // 1. Prepare for rendering: Reset transform and clear the whole canvas.
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);

        // 2. FIRST PASS: Draw all scalable items in world space.
        this.ctx.setTransform(scale, 0, 0, scale, originX * scale, originY * scale);
        this.shapes.forEach(shape => {
            if (shape.fixedSize) return; // Skip fixed-size items for now.
            
            // Draw the shape and its highlight (if hovered).
            this.drawShape(shape, this.hoveredShape === shape);
        });

        // 3. SECOND PASS: Draw all fixed-size items in screen space.
        this.ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset to screen space.
        this.shapes.forEach(shape => {
            if (!shape.fixedSize) return; // Skip scalable items.

            // Calculate the shape's position on the screen.
            const screenX = (shape.x + originX) * scale;
            const screenY = (shape.y + originY) * scale;
            
            // Draw the shape and its highlight, providing the calculated screen coordinates.
            this.drawShape(shape, this.hoveredShape === shape, screenX, screenY);
        });
        
        // 4. TOOLTIP PASS: Draw the tooltip for the hovered shape (if any).
        if (this.hoveredShape) {
            // Calculate the anchor position for the tooltip on the screen.
            const anchorX = (this.hoveredShape.x + originX) * scale;
            const anchorY = (this.hoveredShape.y + originY) * scale;
            this.drawTooltip(this.hoveredShape, anchorX, anchorY);
        }
    }

    drawShape(shape, isHovered, screenX, screenY)
    {
        this.ctx.save();

        // If drawing in screen space, we need to translate to the correct position.
        if (shape.fixedSize && screenX !== undefined) {
            this.ctx.translate(screenX, screenY);
        }

        // Apply shape-specific styles.
        this.ctx.fillStyle = shape.fillStyle;
        this.ctx.strokeStyle = shape.strokeStyle || 'transparent';
        this.ctx.lineWidth = shape.lineWidth || 1;
        this.ctx.font = shape.font;

        // Arbitrary command injection -- TODO: Security?
        if (shape.beforeDraw && Array.isArray(shape.beforeDraw)) {
            shape.beforeDraw.forEach(cmd => {
                try {
                    if (cmd.prop) {
                        // Set a property, e.g., ctx.shadowColor = 'blue'
                        this.ctx[cmd.prop] = cmd.value;
                    } else if (cmd.method) {
                        // Call a method, e.g., ctx.setLineDash([5, 15])
                        this.ctx[cmd.method](...(cmd.args || []));
                    }
                } catch (e) {
                    console.error("Error applying custom draw command:", e);
                }
            });
        }


        // Use 0,0 for coordinates if in screen space, as we've already translated the context.
        const x = shape.fixedSize ? 0 : shape.x;
        const y = shape.fixedSize ? 0 : shape.y;

        // Draw the shape based on its type.
        switch (shape.type) {
            case 'circle':
                this.ctx.beginPath();
                this.ctx.arc(x, y, shape.radius, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.stroke();
                break;

            case 'rect':
                this.ctx.fillRect(x, y, shape.width, shape.height);
                this.ctx.strokeRect(x, y, shape.width, shape.height);
                break;

            case 'text':
                this.ctx.fillText(shape.text, x, y);
                break;
        }

        // Draw hover highlight.
        if (isHovered) {
            this.ctx.strokeStyle = 'yellow';
            this.ctx.lineWidth = shape.fixedSize ? 2 : 6; // Thinner line for fixed-size items.
            switch (shape.type) {
                case 'circle':
                    this.ctx.beginPath();
                    this.ctx.arc(x, y, shape.radius, 0, Math.PI * 2);
                    this.ctx.stroke();
                    break;

                case 'rect':
                    this.ctx.strokeRect(x, y, shape.width, shape.height);
                    break;
            }
        }
        this.ctx.restore();
    }


    /**
     * onMouseMove is called by the viewer when the mouse moves over the main canvas.
     * This is where we perform our hit detection.
     */
    onMouseMove(e)
    {
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
    drawTooltip(shape, anchorX, anchorY)
    {
        const fontSize = 12; // Fixed font size for readability.
        const padding = 8;   // Fixed padding.
        this.ctx.font = `${fontSize}px sans-serif`;
        
        const textMetrics = this.ctx.measureText(shape.tooltip);
        const boxWidth = textMetrics.width + padding * 2;
        const boxHeight = fontSize + padding * 2;
        
        // Position the tooltip above the shape's anchor point.
        const boxX = anchorX - boxWidth / 2;
        const boxY = anchorY - boxHeight - (shape.fixedSize ? 10 : 20);

        // Draw the tooltip box.
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        this.ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

        // Draw the tooltip text.
        this.ctx.fillStyle = 'white';
        this.ctx.fillText(shape.tooltip, boxX + padding, boxY + fontSize + padding / 2);
    }

    // TODO: I need to call this? I need a destroy() in viewer too.
    destroy()
    {
        this.resizeObserver.disconnect();
        this.overlayCanvas.remove();
    }
}
