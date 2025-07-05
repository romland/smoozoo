export class MinimapPlugin
{
    /**
     * @param {object} viewerApi Smoozoo viewer API
     * @param {object} options Plugin-specific options
     */
    constructor(viewerApi, options)
    {
        this.api = viewerApi;
        this.gl = this.api.getCanvas().getContext('webgl');
        this.settings = {
            // Max/min size veritcally OR horizontally. The largest axis will decide.
            minimapMaxSize: 150,
            minimapMinSize: 50,
            ...options
        };

        this.container = document.getElementById('minimap-container');
        this.imageCanvas = document.getElementById('minimap-image');
        this.viewport = document.getElementById('minimap-viewport');

        if (!this.container || !this.imageCanvas || !this.viewport) {
            console.error("Minimap DOM elements not found!");
            return;
        }

        // Primary update hook called by the Smoozoo's render loop.
        // Responsible for syncing the viewport rectangle on the minimap.
        this.update = this._updateViewport.bind(this);
    }


    /**
     * Called by viewer when main image and its WebGL tiles have been loaded.
     */
    onImageLoaded()
    {
        this._generateAndDisplayThumbnail();
    }


    /**
     * Asynchronously generates the thumbnail and then updates the DOM to display it.
     * @private
     */
    async _generateAndDisplayThumbnail()
    {
        this.container.style.display = 'block';
        this.imageCanvas.style.opacity = 0;

        const { width: imageWidth, height: imageHeight } = this.api.getImageSize();
        
        // Calculate dimensions
        const aspect = imageWidth / imageHeight;
        let thumbWidth, thumbHeight;

        if (aspect > 1) {
            thumbWidth = this.settings.minimapMaxSize;
            thumbHeight = this.settings.minimapMaxSize / aspect;
        } else {
            thumbHeight = this.settings.minimapMaxSize;
            thumbWidth = this.settings.minimapMaxSize * aspect;
        }

        this.imageCanvas.width = Math.round(thumbWidth);
        this.imageCanvas.height = Math.round(thumbHeight);

        // async call and wait for the pixel data
        console.time("MinimapPlugin::api.renderToPixelsAsync");
        const pixels = await this.api.renderToPixelsAsync(this.imageCanvas.width, this.imageCanvas.height);
        console.timeEnd("MinimapPlugin::api.renderToPixelsAsync");

        if (!pixels) {
            console.error("Failed to generate minimap thumbnail.");
            this.container.style.display = 'none';
            return;
        }

        // This is actually faster than you'd think...
        const thumbCtx = this.imageCanvas.getContext('2d');
        const imageData = new ImageData(new Uint8ClampedArray(pixels.buffer), this.imageCanvas.width, this.imageCanvas.height);
        thumbCtx.putImageData(imageData, 0, 0);

        // Set container dimensions
        const containerWidth = Math.max(this.imageCanvas.width, this.settings.minimapMinSize);
        const containerHeight = Math.max(this.imageCanvas.height, this.settings.minimapMinSize);

        this.container.style.width = containerWidth + 'px';
        this.container.style.height = containerHeight + 'px';

        // Fade the thumbnail in
        this.imageCanvas.style.transition = 'opacity 0.3s ease-in-out';
        this.imageCanvas.style.opacity = 1;

        this._attachEventListeners();
    }


    /**
     * Updates the position and size of the viewport indicator on the minimap.
     * Called every frame by the main render loop.
     * @private
     */
    _updateViewport()
    {
        const { width: imageWidth, height: imageHeight } = this.api.getImageSize();
        const { scale, originX, originY } = this.api.getTransform();
        const canvas = this.api.getCanvas();

        const viewWidth = canvas.width / scale;
        const viewHeight = canvas.height / scale;

        const viewRect = { x: -originX, y: -originY, width: viewWidth, height: viewHeight };
        const imgRect = { x: 0, y: 0, width: imageWidth, height: imageHeight };

        // Calculate the intersection of the viewport and the image
        const intersectX = Math.max(imgRect.x, viewRect.x);
        const intersectY = Math.max(imgRect.y, viewRect.y);
        const intersectWidth = Math.min(imgRect.x + imgRect.width, viewRect.x + viewRect.width) - intersectX;
        const intersectHeight = Math.min(imgRect.y + imgRect.height, viewRect.y + viewRect.height) - intersectY;

        if (intersectWidth < 0 || intersectHeight < 0) {
            this.viewport.style.display = 'none'; // Hide if not intersecting
            return;
        }

        this.viewport.style.display = 'block';
        const ratio = this.container.clientWidth / imageWidth;
        this.viewport.style.left = `${intersectX * ratio}px`;
        this.viewport.style.top = `${intersectY * ratio}px`;
        this.viewport.style.width = `${intersectWidth * ratio}px`;
        this.viewport.style.height = `${intersectHeight * ratio}px`;
    }

    
    _calculateTargetOrigin(e)
    {
        const { width: imageWidth, height: imageHeight } = this.api.getImageSize();
        const { scale } = this.api.getTransform();
        const canvas = this.api.getCanvas();
        const rect = this.container.getBoundingClientRect();
        
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        const clickX = clientX - rect.left;
        const clickY = clientY - rect.top;

        const targetWorldX = (clickX / rect.width) * imageWidth;
        const targetWorldY = (clickY / rect.height) * imageHeight;

        const viewWidth = canvas.width / scale;
        const viewHeight = canvas.height / scale;

        return {
            x: (viewWidth / 2) - targetWorldX,
            y: (viewHeight / 2) - targetWorldY
        };
    }


    /**
     * Attach all DOM event listeners for minimap interaction.
     * @private
     */
    _attachEventListeners()
    {
        const onDrag = (e) => {
            const { x, y } = this._calculateTargetOrigin(e);
            this.api.jumpToOrigin(x, y);
        };

        const onDragEnd = () => {
            window.removeEventListener('mousemove', onDrag);
            window.removeEventListener('mouseup', onDragEnd);
            this.container.removeEventListener('touchmove', onDrag);
            window.removeEventListener('touchend', onDragEnd);
        };

        const onDragStart = (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.api.cancelAllAnimations();
            
            const { x, y } = this._calculateTargetOrigin(e);
            this.api.jumpToOrigin(x, y);

            if (e.type === 'mousedown') {
                window.addEventListener('mousemove', onDrag);
                window.addEventListener('mouseup', onDragEnd);
            } else if (e.type === 'touchstart') {
                this.container.addEventListener('touchmove', onDrag, { passive: false });
                window.addEventListener('touchend', onDragEnd);
            }
        };

        this.container.addEventListener('mousedown', onDragStart);
        this.container.addEventListener('touchstart', onDragStart, { passive: false });
    }
}