/**
 * InfoLabel Plugin Helper
 *
 * Creates and manages an HTML label and a clickable info icon. It uses a Modal
 * component to display all image metadata when the icon is clicked.
 */
import { Modal } from './smoozoo-plugin-collection-helpers.js';

/**
 * InfoLabel Plugin Helper
 *
 * Creates and manages an HTML label and a clickable info icon. It uses a Modal
 * component to display all image metadata when the icon is clicked.
 */
export class InfoLabel {
    constructor(targetElement) {
        this.targetElement = targetElement;

        // Element Properties
        this.containerElement = null;
        this.labelElement = null;
        this.infoButtonElement = null;
        
        // This class now OWNS an instance of the Modal
        this.modal = new Modal(this.targetElement);
        
        this.currentImageDetails = null;

        this.init();
    }

    init() {
        // --- Info Label and Icon Container (This part is correct) ---
        this.containerElement = document.createElement('div');
        this.containerElement.className = "highres-infolabel";
        Object.assign(this.containerElement.style, {
            position: 'absolute', top: '0', left: '0',
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            color: 'white', padding: '4px 8px',
            fontSize: '12px', fontFamily: 'sans-serif',
            borderRadius: '3px', pointerEvents: 'none',
            display: 'none', transition: 'opacity 0.2s ease-in-out',
            display: 'flex', alignItems: 'center', gap: '8px'
        });

        this.labelElement = document.createElement('span');
        this.labelElement.className = "highres-infolabel-text";
        this.labelElement.style.whiteSpace = 'nowrap';

        this.infoButtonElement = document.createElement('button');
        this.infoButtonElement.className = "highres-infolabel-button";
        this.infoButtonElement.innerHTML = '&#9432;';
        Object.assign(this.infoButtonElement.style, {
            pointerEvents: 'auto', cursor: 'pointer', background: 'none',
            border: 'none', color: 'rgba(80, 80, 255, 1)', fontSize: '22px',
            padding: '0', lineHeight: '0.8'
        });

        this.containerElement.appendChild(this.infoButtonElement);
        this.containerElement.appendChild(this.labelElement);
        this.targetElement.appendChild(this.containerElement);
        
        // --- Event Listener (This part is correct) ---
        this.infoButtonElement.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.currentImageDetails) {
                const title = this.currentImageDetails.fileName || 'Image Details';
                const bodyContent = this._createModalContent(this.currentImageDetails);
                
                this.modal.setContent({ title, bodyContent });
                this.modal.show();
            }
        });
    }

    /**
     * Creates the specific HTML content (a DL list) for the metadata modal.
     * @param {object} details The image details object.
     * @returns {HTMLDListElement} The populated DL element.
     * @private
     */
    _createModalContent(details) {
        const list = document.createElement('dl');

        const renderObject = (obj, container) => {
            for (const key in obj) {
                if (!obj.hasOwnProperty(key) || key.startsWith('_')) continue;
                const value = obj[key];
                if (value === null || value === undefined || value === '') continue;
                
                const formattedKey = key.replace(/([A-Z])/g, ' $1').trim();
                const dt = document.createElement('dt');
                dt.textContent = formattedKey;
                const dd = document.createElement('dd');

                if (typeof value === 'object' && !Array.isArray(value)) {
                    container.appendChild(dt);
                    container.appendChild(dd);
                    const nestedDl = document.createElement('dl');
                    dd.appendChild(nestedDl);
                    renderObject(value, nestedDl);
                } else {
                    dd.textContent = value.toString();
                    container.appendChild(dt);
                    container.appendChild(dd);
                }
            }
        };

        renderObject(details, list);
        return list;
    }

    /**
     * Updates the label's content, position, and visibility.
     * @param {object} params - The necessary data from the main plugin's render loop.
     */
    update({ image, dimensions, transform, canvas, config }) {
        if (!image || !image.details || !dimensions || !transform || !canvas || !config) {
            this.containerElement.style.display = 'none';
            this.currentImageDetails = null;
            return;
        }

        this.currentImageDetails = image.details;

        const { finalWidth, finalHeight, offsetX, offsetY } = dimensions;
        // **FIXED**: Re-added originX and originY which were omitted in the previous refactoring.
        const { scale, originX, originY } = transform;

        // **FIXED**: The position calculation now correctly includes the transform origin,
        // restoring the label's correct position.
        const screenLeft = (image.x + offsetX + originX) * scale;
        const screenTop = (image.y + offsetY + originY) * scale;
        const screenRight = screenLeft + (finalWidth * scale);
        const screenBottom = screenTop + (finalHeight * scale);

        const isVisible = screenLeft < canvas.width && screenRight > 0 && screenTop < canvas.height && screenBottom > 0;

        if (!isVisible) {
            this.containerElement.style.display = 'none';
            return;
        }

        const geo = image.details.geo ? `${image.details.geo.city || ''}, ${image.details.geo.country || ''}`.replace(/^, |, $/g, '') : null;
        const dateTime = image.details.exif?.DateTimeOriginal?.rawValue;
        let infoString = dateTime ? `${dateTime.split(' ')[0].replace(/:/g, "-")}` : '';
        if (geo) {
            infoString += `${infoString ? ' | ' : ''}${geo}`;
        }

        if (infoString) {
            this.labelElement.textContent = infoString;
            this.labelElement.style.display = 'inline';
        } else {
            this.labelElement.style.display = 'none';
        }

        const corner = config.infoLabelCorner || 'bottom-right';
        const padding = 10;
        let containerX, containerY, cssTransform;

        switch (corner) {
            case 'top-left':
                containerX = Math.max(screenLeft, 0) + padding;
                containerY = Math.max(screenTop, 0) + padding;
                cssTransform = `translate(0, 0)`;
                break;
            case 'top-right':
                containerX = Math.min(screenRight, canvas.width) - padding;
                containerY = Math.max(screenTop, 0) + padding;
                cssTransform = `translate(-100%, 0)`;
                break;
            case 'bottom-left':
                containerX = Math.max(screenLeft, 0) + padding;
                containerY = Math.min(screenBottom, canvas.height) - padding;
                cssTransform = `translate(0, -100%)`;
                break;
            default: // 'bottom-right'
                containerX = Math.min(screenRight, canvas.width) - padding;
                containerY = Math.min(screenBottom, canvas.height) - padding;
                cssTransform = `translate(-100%, -100%)`;
                break;
        }

        this.containerElement.style.opacity = 1;
        this.containerElement.style.transform = `translate(${containerX}px, ${containerY}px) ${cssTransform}`;
        this.containerElement.style.display = 'flex';
    }
}