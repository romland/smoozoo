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
        this.labelElement.classList = "highres-infolabel";
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

        const { finalWidth, finalHeight, offsetX, offsetY } = dimensions;
        const { scale, originX, originY } = transform;

        // 1. Calculate the image's full bounding box on the screen
        const screenLeft = (image.x + offsetX + originX) * scale;
        const screenTop = (image.y + offsetY + originY) * scale;
        const screenRight = screenLeft + (finalWidth * scale);
        const screenBottom = screenTop + (finalHeight * scale);

        // 2. Check if the image rectangle intersects with the canvas rectangle at all
        const isVisible = screenLeft < canvas.width && screenRight > 0 && screenTop < canvas.height && screenBottom > 0;

        if (!isVisible) {
            this.labelElement.style.display = 'none';
            return;
        }

        // 3. Format the label string from image details
        const geo = image.details.geo ? `${image.details.geo.city || ''}, ${image.details.geo.country || ''}`.replace(/^, |, $/g, '') : null;
        const dateTime = image.details.exif?.DateTimeOriginal?.rawValue;
        let infoString = dateTime ? `${dateTime.split(' ')[0].replace(/:/g, "-")}` : ''; // Just the date part
        if (geo) {
            infoString += `${infoString ? ' | ' : ''}${geo}`;
        }

        if (!infoString) {
            this.labelElement.style.display = 'none';
            return;
        }

        // 4. Position the label based on the corner configuration
        const corner = config.infoLabelCorner || 'bottom-right';
        const padding = 10; // Screen pixels
        let labelX, labelY, cssTransform;

        switch (corner) {
            case 'top-left':
                labelX = Math.max(screenLeft, 0) + padding;
                labelY = Math.max(screenTop, 0) + padding;
                cssTransform = `translate(0, 0)`;
                break;

            case 'top-right':
                labelX = Math.min(screenRight, canvas.width) - padding;
                labelY = Math.max(screenTop, 0) + padding;
                cssTransform = `translate(-100%, 0)`;
                break;

            case 'bottom-left':
                labelX = Math.max(screenLeft, 0) + padding;
                labelY = Math.min(screenBottom, canvas.height) - padding;
                cssTransform = `translate(0, -100%)`;
                break;

            default: // 'bottom-right'
                labelX = Math.min(screenRight, canvas.width) - padding;
                labelY = Math.min(screenBottom, canvas.height) - padding;
                cssTransform = `translate(-100%, -100%)`;
                break;
        }

        // 5. Update and show the label
        this.labelElement.textContent = infoString;
        this.labelElement.style.opacity = 1;
        this.labelElement.style.transform = `translate(${labelX}px, ${labelY}px) ${cssTransform}`;
        this.labelElement.style.display = 'block';
    }

}