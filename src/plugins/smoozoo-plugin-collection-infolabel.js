export class InfoLabel {
    constructor(targetElement) {
        this.targetElement = targetElement;
        this.labelElements = new Map(); // Use a map to store a label for each image ID
    }

    getOrCreateLabelElement(imageId) {
        if (this.labelElements.has(imageId)) {
            return this.labelElements.get(imageId);
        }

        // If it doesn't exist, create, style, and append it
        const labelElement = document.createElement('div');
        labelElement.style.position = 'absolute';
        labelElement.style.top = '0';
        labelElement.style.left = '0';
        labelElement.style.backgroundColor = 'rgba(0, 0, 0, 0.6)';
        labelElement.style.color = 'white';
        labelElement.style.padding = '4px 8px';
        labelElement.style.fontSize = '12px';
        labelElement.style.fontFamily = 'sans-serif';
        labelElement.style.borderRadius = '3px';
        labelElement.style.pointerEvents = 'none';
        labelElement.style.display = 'none';
        labelElement.style.whiteSpace = 'nowrap';
        labelElement.style.transition = 'opacity 0.2s ease-in-out, transform 0.0s linear'; // Fast transform
        this.targetElement.appendChild(labelElement);
        this.labelElements.set(imageId, labelElement);
        return labelElement;
    }

    updateAll({ labels, transform, canvas }) {
        const activeImageIds = new Set();

        for (const labelInfo of labels) {
            const { image, dimensions } = labelInfo;
            activeImageIds.add(image.id);

            const labelElement = this.getOrCreateLabelElement(image.id);

            const geo = image.details.geo ? `${image.details.geo.city || ''}, ${image.details.geo.country || ''}`.replace(/^, |, $/g, '') : null;
            const dateTime = image.details.exif?.DateTimeOriginal?.rawValue;
            let infoString = dateTime ? `${dateTime.split(' ')[0]}` : '';
            if (geo) {
                infoString += `${infoString ? ' | ' : ''}${geo}`;
            }

            if (!infoString) {
                labelElement.style.display = 'none';
                continue;
            }

            const { finalWidth, finalHeight, offsetX, offsetY } = dimensions;
            const { scale, originX, originY } = transform;
            const worldX_br = image.x + offsetX + finalWidth;
            const worldY_br = image.y + offsetY + finalHeight;
            const screenX_br = (worldX_br + originX) * scale;
            const screenY_br = (worldY_br + originY) * scale;

            if (screenX_br < 10 || screenX_br > canvas.width - 10 || screenY_br < 10 || screenY_br > canvas.height - 10) {
                labelElement.style.display = 'none';
            } else {
                labelElement.textContent = infoString;
                labelElement.style.opacity = 1;
                labelElement.style.transform = `translate(${screenX_br - 10}px, ${screenY_br - 10}px) translate(-100%, -100%)`;
                labelElement.style.display = 'block';
            }
        }

        // Hide any labels for images that are no longer active
        for (const [imageId, labelElement] of this.labelElements.entries()) {
            if (!activeImageIds.has(imageId)) {
                labelElement.style.display = 'none';
            }
        }
    }
}