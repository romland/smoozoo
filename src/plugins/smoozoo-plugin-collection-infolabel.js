/**
 * InfoLabel Plugin Helper
 *
 * Creates and manages an HTML label that sticks to a corner of a high-resolution
 * image within the Smoozoo viewer, displaying metadata.
 */
export class InfoLabel {
    /**
     * @param {HTMLElement} targetElement The main container element of the Smoozoo instance.
     */
    constructor(targetElement) {
        this.targetElement = targetElement;
        this.labelElement = null;
        this.init();
    }

    /**
     * Creates and styles the label div and appends it to the DOM.
     */
    init() {
        this.labelElement = document.createElement('div');
        this.labelElement.style.position = 'absolute';
        this.labelElement.style.top = '0'; // Controlled by transform for performance
        this.labelElement.style.left = '0';
        this.labelElement.style.backgroundColor = 'rgba(0, 0, 0, 0.6)';
        this.labelElement.style.color = 'white';
        this.labelElement.style.padding = '4px 8px';
        this.labelElement.style.fontSize = '12px';
        this.labelElement.style.fontFamily = 'sans-serif';
        this.labelElement.style.borderRadius = '3px';
        this.labelElement.style.pointerEvents = 'none';
        this.labelElement.style.display = 'none';
        this.labelElement.style.whiteSpace = 'nowrap';
        this.labelElement.style.transition = 'opacity 0.2s ease-in-out';
        this.targetElement.appendChild(this.labelElement);
    }

    /**
     * Updates the label's content, position, and visibility.
     * This is the main hook called from the render loop.
     * @param {object} params - The necessary data from the main plugin's render loop.
     */
    update({ image, dimensions, transform, canvas, config }) {
        // If there's no valid image to display a label for, hide the element and exit.
        if (!image || !image.details || !dimensions || !transform || !canvas || !config) {
            this.labelElement.style.display = 'none';
            return;
        }

        // 1. Format the label string from image details
        const geo = image.details.geo ? `${image.details.geo.city || ''}, ${image.details.geo.country || ''}`.replace(/^, |, $/g, '') : null;
        const dateTime = image.details.exif?.DateTimeOriginal?.rawValue;
        let infoString = dateTime ? `${dateTime.split(' ')[0]}` : ''; // Just the date part
        if (geo) {
            infoString += `${infoString ? ' | ' : ''}${geo}`;
        }

        // If there's nothing to show, hide and exit.
        if (!infoString) {
            this.labelElement.style.display = 'none';
            return;
        }

        // 2. Calculate the on-screen position of the image's bottom-right corner
        const { finalWidth, finalHeight, offsetX, offsetY } = dimensions;
        const { scale, originX, originY } = transform;
        
        const worldX_br = image.x + offsetX + finalWidth;
        const worldY_br = image.y + offsetY + finalHeight;
        const screenX_br = (worldX_br + originX) * scale;
        const screenY_br = (worldY_br + originY) * scale;

        // 3. Check if the corner is visible within the canvas bounds (with a margin)
        if (screenX_br < 10 || screenX_br > canvas.width - 10 || screenY_br < 10 || screenY_br > canvas.height - 10) {
            this.labelElement.style.display = 'none';
            return;
        }
        
        // 4. Calculate opacity to fade the label in/out with zoom
        const fadeStart = config.highResThreshold;
        const fadeEnd = fadeStart + 0.5;
        const opacity = Math.min(1, Math.max(0, (scale - fadeStart) / (fadeEnd - fadeStart)));

        // 5. Update and show the label
        this.labelElement.textContent = infoString;
        this.labelElement.style.opacity = opacity;
        // Use translate for positioning to be GPU-accelerated and avoid layout shifts.
        // The -10px provides padding from the corner. translate(-100%, -100%) aligns the bottom-right of the label.
        this.labelElement.style.transform = `translate(${screenX_br - 10}px, ${screenY_br - 10}px) translate(-100%, -100%)`;
        this.labelElement.style.display = 'block';
    }
}