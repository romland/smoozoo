/**
 * InfoLabel Plugin Helper
 *
 * Creates a label and info icon on an image. The icon opens a modal,
 * and a new context menu provides image-specific actions.
 */
import { Modal, ContextMenu } from './smoozoo-plugin-collection-helpers.js';

export class InfoLabel {
    constructor(targetElement, plugin) {
        this.targetElement = targetElement;
        this.plugin = plugin;
        
        this.containerElement = null;
        this.labelElement = null;
        this.infoButtonElement = null;
        
        this.modal = new Modal(this.targetElement);
        this.contextMenu = null;
        
        this.currentImageDetails = null;

        this.init();
    }

    init() {
        this.containerElement = document.createElement('div');
        this.containerElement.className = "highres-infolabel";
        Object.assign(this.containerElement.style, {
            position: 'absolute', top: '0', left: '0',
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            color: 'white', padding: '4px 8px',
            fontSize: '12px', fontFamily: 'sans-serif',
            borderRadius: '3px', pointerEvents: 'none',
            display: 'none', transition: 'opacity 0.2s ease-in-out',
            alignItems: 'center', gap: '8px'
        });

        this.labelElement = document.createElement('span');
        this.labelElement.className = "highres-infolabel-text";
        this.labelElement.style.whiteSpace = 'nowrap';

        this.infoButtonElement = document.createElement('button');
        this.infoButtonElement.className = "highres-infolabel-button";
        this.infoButtonElement.innerHTML = '&#9432;';
        Object.assign(this.infoButtonElement.style, {
            pointerEvents: 'auto', cursor: 'pointer', background: 'none',
            border: 'none', color: '#61afef', fontSize: '30px',
            padding: '0', lineHeight: '0.8', marginTop: "-4px"
        });
        
        // Create the elements the ContextMenu needs before we call it.
        const menuButton = document.createElement('button');
        menuButton.className = 'smoozoo-context-menu-btn';
        menuButton.title = 'Actions';
        menuButton.innerHTML = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2"></circle><circle cx="12" cy="5" r="2"></circle><circle cx="12" cy="19" r="2"></circle></svg>`;
        menuButton.style.pointerEvents = 'auto'; // Make it clickable

        const menuPanel = document.createElement('ul');
        menuPanel.className = 'smoozoo-context-menu-panel';

        // Add the created elements to the main container in the correct visual order
        this.containerElement.appendChild(menuButton);
        this.containerElement.appendChild(this.infoButtonElement);
        this.containerElement.appendChild(this.labelElement);
        this.containerElement.appendChild(menuPanel); // The panel is positioned absolutely

        const infoLabelMenuStructure = [
            { label: 'Select Image', action: 'select-image' },
            { type: 'separator' },
            { label: 'Copy Image URL', action: 'copy-url' },
            { label: 'Copy Metadata (JSON)', action: 'copy-json' },
        ];
        
        // Now, instantiate ContextMenu with the live elements we just created.
        this.contextMenu = new ContextMenu({
            menuButton: menuButton,
            menuPanel: menuPanel,
            menuStructure: infoLabelMenuStructure,
            onAction: (detail) => this._handleMenuAction(detail)
        });
        
        this.targetElement.appendChild(this.containerElement);

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

    _handleMenuAction({ action }) {
        if (!this.currentImageDetails || !this.plugin) return;

        switch (action) {
            case 'copy-url':
                const url = this.plugin.config.apiOrigin + this.currentImageDetails.highRes;
                navigator.clipboard.writeText(url).then(() => console.log('URL copied!'));
                break;
            case 'copy-json':
                const json = JSON.stringify(this.currentImageDetails, null, 2);
                navigator.clipboard.writeText(json).then(() => console.log('JSON copied!'));
                break;
            case 'select-image':
                this.plugin.selectionDeck.toggle(this.currentImageDetails);
                break;
        }
    }
    
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

    update({ image, dimensions, transform, canvas, config }) {
        if (!image || !image.details || !dimensions || !transform || !canvas || !config) {
            this.containerElement.style.display = 'none';
            this.currentImageDetails = null;
            return;
        }

        this.currentImageDetails = image.details;

        const { finalWidth, finalHeight, offsetX, offsetY } = dimensions;
        const { scale, originX, originY } = transform;

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

        this.labelElement.style.display = infoString ? 'inline' : 'none';
        this.labelElement.textContent = infoString;
        
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

        this.containerElement.style.opacity = '1';
        this.containerElement.style.transform = `translate(${containerX}px, ${containerY}px) ${cssTransform}`;
        this.containerElement.style.display = 'flex';
    }
}