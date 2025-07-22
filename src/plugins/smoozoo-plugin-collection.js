// The OffscreenCanvas Worker Architecture

/**
 * Smoozoo Collection Plugin
 *
 * This plugin transforms the Smoozoo viewer into a navigable gallery of images.
 */
import { ThumbnailCache, LocalStorageDB, Quadtree } from './smoozoo-plugin-collection-helpers.js';
import { ImageInfoCache } from './smoozoo-plugin-collection-imageinfocache.js';
import { SelectionDeck } from './smoozoo-plugin-collection-selectiondeck.js';
import { InfoLabel } from './smoozoo-plugin-collection-infolabel.js';
import { RenderOrchestrator } from './smoozoo-plugin-collection-render-orchestrator.js';


export class SmoozooCollection
{
    static toString() { return "SmoozooCollection"; }
    static path = "./plugins/smoozoo-plugin-collection.js";

    constructor(api, options, targetElement) {
        this.api = api;
        this.options = options;
        this.gl = api.getGlContext();
        this.canvas = api.getCanvas();
        this.targetElement = targetElement;

        // --- Caching and Worker Setup ---
        this.cache = new ThumbnailCache();
        this.imageInfoCache = new ImageInfoCache(this.options.apiOrigin);        
        this.worker = new Worker(new URL('./smoozoo-plugin-collection-thumbnail.worker.js', import.meta.url));
        this.worker.onmessage = this.handleWorkerMessage.bind(this);

        this.collectionName = options.collectionName;

        console.log("Collection name:", this.collectionName);

        // --- Configuration ---
        this.config = {
            images: options.images || [],
            thumbnailSize: options.thumbnailSize || 256,
            uploadConfig: options.uploadConfig || null, // e.g., { url: '/upload' }
            padding: options.padding || 15,
            cols: options.cols || 5,
            selectionColor: options.selectionColor || 'rgba(40, 120, 255, 0.4)',
            backgroundColor: options.backgroundColor || '#0e0422',

            layoutMode: options.layoutMode || 'masonry', // 'masonry' or 'row'
            maxRowWidth: options.maxRowWidth || 8000, // For row mode
            minWorldHeight: options.minWorldHeight || 0,
            maxWorldHeight: options.maxWorldHeight || 0,

            highResThreshold: options.highResThreshold || 1.5,
            highResCacheLimit: options.highResCacheLimit || 10,
            highResLoadBuffer: options.highResLoadBuffer || 0.5,

            fetchTags: options.fetchTags || false, // Default to not fetching tags

            loadBuffer: options.loadBuffer || 1.0, // Load 1 viewport height/width around the visible area

            highResLoadDelay: options.highResLoadDelay || 250, // time in ms to wait before loading

            // Load instantly if the image width on screen is >= 80% of the canvas width.
            instantLoadThreshold: options.instantLoadThreshold || 0.8,

            apiOrigin: options.apiOrigin || '',
            maxConcurrentRequests: options.maxConcurrentRequests || 15,

            thumbnailStrategy: options.thumbnailStrategy || 'server',

            deckConfig: {
                apiOrigin: this.options.apiOrigin
            },

            infoLabelCorner: options.infoLabelCorner || 'bottom-left', // Accepts: 'top-left', 'top-right', 'bottom-left', 'bottom-right'
        };

        // --- State ---
        this.images = []; // { id, src, thumbTex, x, y, width, height }
        this.highResLoadDebounceTimer = null; // to hold timer ID
        this.worldSize = {
            width: 0,
            height: 0
        };
        this.lastMouseWorldPos = {
            x: 0,
            y: 0
        };

        this.isSelectModeActive = false;


        this.imageUnderCursor = null; // Replaces 'focusedImage'
        this.lastMouseWorldPos = { x: 0, y: 0 }; // Track mouse in world coordinates
        this.selectionDeck = null; // Will hold the SelectionDeck instance

        this.imageLoadQueue = new Set(); // Tracks images that need loading

        this.highResCache = new Map(); // Stores the actual textures
        this.highResUsageList = []; // Tracks usage order for LRU logic      

        this.quadtree = null;
        this.renderer = null; 

        this.requestQueue = []; // Holds images waiting to be loaded
        this.currentlyProcessing = 0; // Count of active network requests

        // --- Tagging ---
        this.db = new LocalStorageDB('smoozoo_tags');
        this.tags = this.db.getAll() || {};

        this.infoLabel = new InfoLabel(this.targetElement);

        this.init();

        // Now that the main images are loaded, tell the deck to load its saved state.
        this.selectionDeck.loadSelection();
    }

    init() {
        console.log("🖼️ Smoozoo Collection Plugin Initializing...");
        this.api.preventInitialLoad();

        // Instantiate renderer and override with its method
        this.renderer = new RenderOrchestrator(this);

        this.api.overrideRenderer(this.render.bind(this));

        this.selectionDeck = new SelectionDeck(this, this.imageInfoCache, this.config.deckConfig, this.targetElement);
        this.selectionDeck.init();

        this.addKeyListeners();

        this.images = this.config.images.map(imgData => {
            const estimatedHeight = this.config.layoutMode === 'masonry' ?
                this.config.thumbnailSize * 1.25 // Estimate portrait for masonry
                :
                this.config.thumbnailSize; // Use fixed height for rows

            // If tags were included in the response, store them in our local DB
            if (imgData.tags && Array.isArray(imgData.tags)) {
                this.tags[imgData.id] = imgData.tags;
            }

            return {
                ...imgData,
                filename: imgData.highRes.split('/').pop().split('?')[0],
                state: 'placeholder',
                thumb: imgData.thumb || null,
                thumbTex: null,
                thumbObjectUrl: null, // <<< ADDED
                width: imgData.thumbWidth,
                height: imgData.thumbHeight,
                thumbWidth: imgData.thumbWidth || this.config.thumbnailSize,
                thumbHeight: imgData.thumbHeight || this.config.thumbnailSize,
                highResState: 'none',
                highResTexture: null,
                x: 0,
                y: 0,
                details: null 
            };
        });

        this.db.setAll(this.tags);

        this.onResize(); // Run initial layout and render
    }


    rebuildQuadtree() {
        // Define the boundary of the entire gallery world
        const bounds = {
            x: 0,
            y: 0,
            width: this.worldSize.width,
            height: this.worldSize.height || 10000 // Fallback height if 0
        };

        // console.log("Rebuilding Quadtree with bounds:", bounds);
        this.quadtree = new Quadtree(bounds);

        for (const image of this.images) {
            this.quadtree.insert(image);
        }
    }

    onResize = () => {
        // console.log("Recalculating layout due to resize...");
        this.calculateLayout();
        this.api.setWorldSize(this.worldSize);
        this.api.requestRender();
    }

    // --- Core Logic ---
    addTextureToCache(image) {
        // Add the new texture to our cache
        this.highResCache.set(image.id, image.highResTexture);
        this.updateCacheUsage(image); // Mark as most recently used

        // If the cache is over the limit, remove the least recently used texture
        if (this.highResCache.size > this.config.highResCacheLimit) {
            const lruImageId = this.highResUsageList.pop(); // Get the ID of the least-used image
            const textureToUnload = this.highResCache.get(lruImageId);

            // Find the corresponding image object to reset its state
            const imageToReset = this.images.find(img => img.id === lruImageId);
            if (imageToReset) {
                console.log(`Unloading high-res texture for: ${imageToReset.filename}`);
                this.gl.deleteTexture(textureToUnload); // Free GPU memory
                imageToReset.highResState = 'none';
                imageToReset.highResTexture = null;
            }

            this.highResCache.delete(lruImageId);
        }
    }

    /**
     * Loads the high-resolution texture for a single image on-demand.
     */
    async requestHighResLoad(image) {
        if (image.highResState !== 'none') return;
        image.highResState = 'loading';

        // Fetch and log (for now) image info when high-res is requested
        this.imageInfoCache.getSingleInfo(image.id).then(details => {
            if (details) {
                // Store details on the image object for potential future use (e.g., drawing on canvas)
                image.details = details; 

                this.api.requestRender();
/*                
                // For now, just log the full details object
                console.log("Details for zoomed image:", details);

                // This is how you would extract and print specific info as requested
                // This will be useful when you want to draw this text over the image.
                const geo = details.geo ? `${details.geo.city || 'N/A'}, ${details.geo.country || 'N/A'}` : null;
                const dateTime = details.exif?.DateTimeOriginal?.rawValue;
                
                let infoString = "";
                
                if (dateTime) {
                    infoString += `Date: ${dateTime}`;
                }

                if (geo) {
                    infoString += `${infoString ? ' | ' : ''}Location: ${geo}`;
                }
                
                if (infoString) {
                    // In the future, you could draw this `infoString` in the bottom right corner.
                    console.log(`Formatted Info: ${infoString}`);
                }
*/
            }
        });

        try {
            const imageUrl = (this.config.apiOrigin + image.highRes).replace(/#/g, '%23');
            const response = await fetch(imageUrl);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const blob = await response.blob();
            const bmp = await createImageBitmap(blob);

            // Always store the original dimensions of the high-res bitmap.
            image.originalWidth = bmp.width;
            image.originalHeight = bmp.height;

            const maxTexSize = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE);

            if (bmp.width <= maxTexSize && bmp.height <= maxTexSize) {
                image.highResTexture = this.createTextureFromImageBitmap(bmp);
                image.highResTiles = null;
            } else {
                image.highResTiles = [];
                image.highResTexture = null;
                image.originalWidth = bmp.width;
                image.originalHeight = bmp.height;
                const numXTiles = Math.ceil(bmp.width / maxTexSize);
                const numYTiles = Math.ceil(bmp.height / maxTexSize);

                for (let y = 0; y < numYTiles; y++) {
                    for (let x = 0; x < numXTiles; x++) {
                        const sx = x * maxTexSize;
                        const sy = y * maxTexSize;
                        const sw = Math.min(maxTexSize, bmp.width - sx);
                        const sh = Math.min(maxTexSize, bmp.height - sy);
                        const tileCanvas = new OffscreenCanvas(sw, sh);
                        const tileCtx = tileCanvas.getContext('2d');
                        tileCtx.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
                        const tileTexture = this.createTextureFromImageBitmap(tileCanvas);
                        image.highResTiles.push({
                            texture: tileTexture,
                            x: sx,
                            y: sy,
                            width: sw,
                            height: sh
                        });
                    }
                }
            }

            image.highResState = 'ready';
            this.addTextureToCache(image);
            this.api.requestRender();

        } catch (e) {
            console.error(`High-res load failed for ${image.highRes}:`, e);
            image.highResState = 'error';
            this.api.requestRender();
        }
    }

    updateCacheUsage(image) {
        // Remove the item from its current position in the list
        const index = this.highResUsageList.indexOf(image.id);
        if (index > -1) {
            this.highResUsageList.splice(index, 1);
        }
        // Add it to the front of the list (most recently used)
        this.highResUsageList.unshift(image.id);
    }


    async handleWorkerMessage(event) {
        const {
            status,
            id, // The worker now sends back the ID
            imageUrl,
            pixelData,
            width,
            height,
            error
        } = event.data;

        // Find the image by its unique ID, not the fragile URL
        const image = this.images.find(img => img.id === id);

        if (!image) {
            // This error should no longer happen
            console.error("Could not find matching image for worker ID:", id);
            this.onRequestFinished({
                id: id
            });
            return;
        }

        if (status === 'success') {
            image.width = width;
            image.height = height;
            image.thumbWidth = width;
            image.thumbHeight = height;

            image.thumbTex = this.createTextureFromPixels(pixelData, width, height);
            image.state = 'ready';

            this.onResize();

            const thumbBlob = await this.imageDataToBlob(pixelData);
            
            // Pre-load the image data into the browser's cache via an Object URL
            const objectURL = URL.createObjectURL(thumbBlob);
            image.thumbObjectUrl = objectURL;
            const preloader = new Image();
            preloader.src = objectURL;

            this.cache.set(image.id, thumbBlob).catch(console.error);
            this.uploadThumbnail(image, thumbBlob);

        } else {
            console.error(`Worker failed for ${imageUrl}:`, error);
            image.state = 'error';
            this.api.requestRender();
        }

        this.onRequestFinished(image);
    }


    async imageDataToBlob(imageData) {
        const canvas = new OffscreenCanvas(imageData.width, imageData.height);
        const ctx = canvas.getContext('2d');
        ctx.putImageData(imageData, 0, 0);
        return await canvas.convertToBlob({
            type: 'image/png'
        });
    }

    /**
     * Processes a thumbnail blob (from server or cache) into a texture and updates the image state.
     * This helper centralizes the logic for handling a successful thumbnail load.
     * @param {object} image The image object to update.
     * @param {Blob} blob The thumbnail data as a Blob.
     */
    async processThumbnailBlob(image, blob)
    {
        // Pre-load the image data into the browser's cache via an Object URL
        const objectURL = URL.createObjectURL(blob);
        image.thumbObjectUrl = objectURL;
        const preloader = new Image();
        preloader.src = objectURL;

        // The rest of the original function
        const bmp = await createImageBitmap(blob);

        image.width = bmp.width;
        image.height = bmp.height;
        image.thumbWidth = bmp.width;
        image.thumbHeight = bmp.height;

        image.thumbTex = this.createTextureFromImageBitmap(bmp);
        image.state = 'ready';

        this.onResize();
        
        this.onRequestFinished(image);
    }

    /**
     * Processes the image request queue, respecting the concurrency limit.
     * This is the main engine for throttled loading.
     */
    processRequestQueue() {
        // Stop if we are already processing the maximum number of requests
        if (this.currentlyProcessing >= this.config.maxConcurrentRequests) {
            return;
        }

        // Prioritize loading images that are currently visible to the user
        this.requestQueue.sort((a, b) => {
            const aIsVisible = a.isVisible ? -1 : 1;
            const bIsVisible = b.isVisible ? -1 : 1;
            return aIsVisible - bIsVisible;
        });

        // Find the next image that is waiting to be loaded
        const nextImage = this.requestQueue.find(img => img.state === 'placeholder');

        if (nextImage) {
            // Mark the image as 'loading' and start the fetch process
            nextImage.state = 'loading';
            this.currentlyProcessing++;

            this.loadThumbnail(nextImage);
        }
    }

    /**
     * Loads a single thumbnail based on the configured strategy.
     * This method orchestrates the loading process by trying server, cache, and generation in order.
     * * @param {object} image The image object to load the thumbnail for.
     */
    async loadThumbnail(image) {
        const strategy = this.config.thumbnailStrategy;

        // --- Attempt 1: Download from Server URL ---
        // Active if strategy is 'server' and a thumb URL is provided.
        if (strategy === 'server' && image.thumb) {
            try {
                const thumbUrl = (this.config.apiOrigin + image.thumb).replace(/#/g, '%23');
                const response = await fetch(thumbUrl);
                if (!response.ok) throw new Error(`Server fetch failed with status ${response.status}`);
                
                const blob = await response.blob();
                await this.processThumbnailBlob(image, blob);
                
                // If successful, also cache it for future offline/fast access.
                this.cache.set(image.id, blob).catch(console.error);
                return; // Success
            } catch (e) {
                console.warn(`Server thumbnail download for ${image.id} failed: ${e.message}. Falling back...`);
            }
        }

        // --- Attempt 2: Retrieve from Local Cache ---
        // Active if strategy is 'cache', or as a fallback for 'server'.
        if (strategy === 'server' || strategy === 'cache') {
            try {
                const cachedBlob = await this.cache.get(image.id);
                if (cachedBlob) {
                    await this.processThumbnailBlob(image, cachedBlob);
                    return; // Success
                }
            } catch (e) {
                console.warn(`IndexedDB cache lookup for ${image.id} failed: ${e.message}. Falling back...`);
            }
        }
        
        // --- Attempt 3: Generate via Worker ---
        // The final fallback for all strategies, or the primary for 'generate'.
        try {
            const safeImageUrl = encodeURI(this.config.apiOrigin + image.highRes);
            this.worker.postMessage({
                id: image.id,
                imageUrl: safeImageUrl,
                thumbnailSize: this.config.thumbnailSize,
            });
        } catch (error) {
            console.error(`Failed to post to thumbnail worker for ${image.id}:`, error);
            image.state = 'error';
            this.onRequestFinished(image); // Still need to finish the request, even on error
            this.api.requestRender();
        }
    }


    /**
     * Callback that runs when an image request (success or fail) is complete.
     * It frees up a processing slot and continues the queue.
     */
    onRequestFinished(image) {
        // Remove the completed image from the queue
        const queueIndex = this.requestQueue.findIndex(req => req.id === image.id);
        if (queueIndex > -1) {
            this.requestQueue.splice(queueIndex, 1);
        }

        // Decrement the active request counter
        this.currentlyProcessing--;

        // Immediately try to process the next item in the queue
        this.processRequestQueue();
    }

    async generateAllThumbnails() {
        const loader = document.getElementById('smoozoo-loader');
        if (loader) loader.classList.remove('hidden');
        document.querySelector('#smoozoo-loader .loader-text').textContent = 'Generating Thumbnails...';

        for (let i = 0; i < this.config.images.length; i++) {
            const src = this.config.images[i];
            const tempCanvas = document.createElement('canvas');
            tempCanvas.style.display = 'none';
            document.body.appendChild(tempCanvas);

            const tempSmoozooApi = window.smoozoo(src, {
                canvas: tempCanvas,
                loadingAnimation: false,
                plugins: []
            });
            await tempSmoozooApi.ready();

            const originalSize = tempSmoozooApi.getImageSize();
            if (originalSize.width === 0 || originalSize.height === 0) continue;

            const ratio = originalSize.width / originalSize.height;
            let thumbWidth, thumbHeight;

            if (ratio > 1) {
                thumbWidth = this.config.thumbnailSize;
                thumbHeight = Math.round(this.config.thumbnailSize / ratio);
            } else {
                thumbHeight = this.config.thumbnailSize;
                thumbWidth = Math.round(this.config.thumbnailSize * ratio);
            }

            const pixelData = await tempSmoozooApi.renderToPixelsAsync(thumbWidth, thumbHeight);

            if (pixelData) {
                // --- START: Corrected Image Flip Logic ---
                const flipCanvas = document.createElement('canvas');
                flipCanvas.width = thumbWidth;
                flipCanvas.height = thumbHeight;
                const flipCtx = flipCanvas.getContext('2d');

                const imageData = new ImageData(new Uint8ClampedArray(pixelData.buffer), thumbWidth, thumbHeight);

                // Create a bitmap that can be drawn with transforms
                const imageBitmap = await createImageBitmap(imageData);

                // Flip the canvas vertically
                flipCtx.save();
                flipCtx.scale(1, -1);
                flipCtx.translate(0, -thumbHeight);

                // Use drawImage, which respects the flip transform
                flipCtx.drawImage(imageBitmap, 0, 0);
                flipCtx.restore();

                const thumbTex = this.createTextureFromPixels(flipCanvas, thumbWidth, thumbHeight);

                // Store the thumbnail's native dimensions separately
                this.images.push({
                    id: src,
                    src,
                    thumbTex,

                    // Layout dimensions (will be changed by calculateLayout)
                    width: thumbWidth,
                    height: thumbHeight,

                    // Native thumbnail dimensions (will NOT be changed)
                    thumbWidth: thumbWidth,
                    thumbHeight: thumbHeight,

                    // ... other properties
                    x: 0,
                    y: 0,
                    highResState: 'none',
                    highResTexture: null,
                });
            }
            document.body.removeChild(tempCanvas);
        }

        if (loader) loader.classList.add('hidden');
    }

    /**
     * Creates a WebGL texture from an ImageBitmap.
     * @param {ImageBitmap} bitmap The image bitmap to upload.
     * @returns {WebGLTexture} The created WebGL texture.
     */
    createTextureFromImageBitmap(bitmap) {
        const gl = this.gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
        gl.generateMipmap(gl.TEXTURE_2D);

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        // Use a filter that works for all texture sizes. (?)
        // gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        // gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        gl.bindTexture(gl.TEXTURE_2D, null);
        return texture;
    }

    calculateLayout() {
        if (!this.images.length) return;

        // --- Option A: Masonry (Column-based) Layout ---
        if (this.config.layoutMode === 'masonry') {
            const {
                cols,
                padding
            } = this.config;
            const colWidth = (this.canvas.width - (padding * (cols + 1))) / cols;
            const columnHeights = Array(cols).fill(padding);

            this.images.forEach(img => {
                const scaleRatio = colWidth / img.thumbWidth;
                const imgHeight = img.thumbHeight * scaleRatio;

                let shortestColumnIndex = 0;
                columnHeights.forEach((h, i) => {
                    if (h < columnHeights[shortestColumnIndex]) {
                        shortestColumnIndex = i;
                    }
                });

                // Overwrite the layout dimensions
                img.x = padding + shortestColumnIndex * (colWidth + padding);
                img.y = columnHeights[shortestColumnIndex];
                img.width = colWidth;
                img.height = imgHeight;

                columnHeights[shortestColumnIndex] += imgHeight + padding;

            });

            this.worldSize.width = this.canvas.width;
            this.worldSize.height = Math.max(...columnHeights);

            // --- Option B: Row-based Layout ---
        } else {
            const {
                padding,
                thumbnailSize,
                maxRowWidth
            } = this.config;
            let x = padding;
            let y = padding;
            let currentRowHeight = 0;

            this.images.forEach(img => {
                const scaleRatio = thumbnailSize / img.height;
                const imgWidth = img.width * scaleRatio;

                if (x > padding && x + imgWidth + padding > maxRowWidth) {
                    y += currentRowHeight + padding;
                    x = padding;
                    currentRowHeight = 0;
                }

                img.x = x;
                img.y = y;
                img.width = imgWidth;
                img.height = thumbnailSize;

                x += imgWidth + padding;
                if (thumbnailSize > currentRowHeight) {
                    currentRowHeight = thumbnailSize;
                }
            });

            this.worldSize.width = maxRowWidth;
            this.worldSize.height = y + currentRowHeight + padding;
        }

        // --- Enforce Min/Max Height for both layouts ---
        if (this.config.minWorldHeight && this.worldSize.height < this.config.minWorldHeight) {
            this.worldSize.height = this.config.minWorldHeight;
        }
        if (this.config.maxWorldHeight && this.worldSize.height > this.config.maxWorldHeight) {
            this.worldSize.height = this.config.maxWorldHeight;
        }

        this.rebuildQuadtree();
    }

    createTextureFromPixels(pixelData, width, height) {
        const gl = this.gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);

        // We must pass the pixel array (.data), not the whole object.
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixelData.data);

        // The rest of the function is correct
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        // gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        // gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        return texture;
    }

    render = () => {
        if (this.renderer) {
            this.renderer.renderFrame();
        }
    }
    

    /**
     * Uploads a generated thumbnail blob to the server in the background.
     * @param {object} image The image object associated with the thumbnail.
     * @param {Blob} blob The thumbnail data as a Blob.
     */
    async uploadThumbnail(image, blob) {
        // Exit if no upload URL is configured
        if (!this.config.uploadConfig?.url) {
            return;
        }

        console.log(`⬆️ Uploading generated thumbnail for: ${image.filename}`);
        const formData = new FormData();
        formData.append('thumbnail', blob, image.filename);

        try {
            const uploadUrl = this.config.apiOrigin + this.config.uploadConfig.url;

            const response = await fetch(uploadUrl, {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                throw new Error(`Server responded with status: ${response.status}`);
            }

            const result = await response.json();
            console.log(`✅ Thumbnail upload successful:`, result.message);

        } catch (error) {
            console.error(`🚨 Thumbnail upload failed for ${image.filename}:`, error);
        }
    }

    // --- Event Handlers ---
    addKeyListeners() {
        window.addEventListener('keydown', (e) => {
            // Press space to select/deselect the focused image
            if (e.code === 'Space') {
                e.preventDefault(); // Prevents page from scrolling
                this.handleSelectAction();
            }
        });
    }

    handleSelectAction()
    {
        if (this.imageUnderCursor) {
            this.selectionDeck.toggle(this.imageUnderCursor);
        }
    }


    /*
    temporary hack until I can fix "this" issue in Smoozoo itself -- properly.
    TODO: One would WANT to do this (but "this" gets fucked up):
        onMouseDown(e)
        onDrag(e)
        onMouseUp(e)
        onMouseMove(e, { worldX, worldY } = {})
    */

    onMouseDown = (e) => {
        // If Shift is not held, allow normal panning.
        if (!e.shiftKey) {
            return true;
        }

        // --- Shift IS held. Start our own drag handling. ---
        e.preventDefault();

        this.selectionBoxStart = { ...this.lastMouseWorldPos };

        // Create the visual box element
        const box = document.createElement('div');
        box.className = 'smoozoo-drag-select-box';
        this.targetElement.appendChild(box);

        // This function will handle mouse movement.
        const handleDrag = (moveEvent) => {
            moveEvent.preventDefault();
            const { scale, originX, originY } = this.api.getTransform();
            const start = this.selectionBoxStart;
            const end = this.lastMouseWorldPos;

            const worldX = Math.min(start.x, end.x);
            const worldY = Math.min(start.y, end.y);
            const worldWidth = Math.abs(start.x - end.x);
            const worldHeight = Math.abs(start.y - end.y);

            box.style.left = `${(worldX + originX) * scale}px`;
            box.style.top = `${(worldY + originY) * scale}px`;
            box.style.width = `${worldWidth * scale}px`;
            box.style.height = `${worldHeight * scale}px`;
        };

        // This function will run when the mouse is released.
        const handleMouseUp = (upEvent) => {
            // Clean up the event listeners
            document.removeEventListener('mousemove', handleDrag);
            document.removeEventListener('mouseup', handleMouseUp);

            // Get the final selection rectangle.
            const start = this.selectionBoxStart;
            const end = this.lastMouseWorldPos;
            const selectionRect = {
                x: Math.min(start.x, end.x),
                y: Math.min(start.y, end.y),
                width: Math.abs(start.x - end.x),
                height: Math.abs(start.y - end.y)
            };

            // Remove the visual box.
            box.remove();

            // Find intersecting images.
            const intersectingImages = this.quadtree.query(selectionRect);

            // Batch fetch info for all drag-selected images
            if (intersectingImages.length > 0) {
                const ids = intersectingImages.map(img => img.id);
                this.imageInfoCache.getInfo(ids).then(detailsMap => {
                    console.log("Details for drag-selected images:", Object.fromEntries(detailsMap));
                });
            }
            
            // Toggle each image's selection status instead of just adding.
            intersectingImages.forEach(image => {
                this.selectionDeck.toggle(image);
            });
        };

        // Attach our own listeners to the document.
        document.addEventListener('mousemove', handleDrag);
        document.addEventListener('mouseup', handleMouseUp);

        // Tell Smoozoo we've handled this.
        return false;
    }

    onMouseMove = (e, { worldX, worldY } = {}) => {
        if (worldX !== undefined && worldY !== undefined) {
            this.lastMouseWorldPos = {
                x: worldX,
                y: worldY
            };

            // We need to request a render to update the highlight in real-time
            // TODO: can this be slow?
            this.api.requestRender();
        }
    }


    tagSelectedDeckImages()
    {
        const selectionSize = this.selectionDeck.selectedImages.size;

        if (selectionSize === 0) {
            alert("No images are selected in the deck.");
            return;
        }

        const newTags = prompt(`Enter tags for the ${selectionSize} selected images (comma-separated):`, "");
        if (newTags === null || newTags.trim() === '') {
            return;
        }

        const tagsToAdd = newTags.split(',').map(t => t.trim()).filter(Boolean);
        if (tagsToAdd.length === 0) {
            return;
        }

        // Apply tags to all images currently in the selection deck
        for (const id of this.selectionDeck.selectedImages.keys()) {
            if (!this.tags[id]) {
                this.tags[id] = [];
            }

            const tagSet = new Set(this.tags[id]);
            tagsToAdd.forEach(tag => tagSet.add(tag));
            this.tags[id] = [...tagSet];
        }

        this.db.setAll(this.tags);

        alert(`Tags added to ${selectionSize} images.`);
        console.log("Updated Tags DB:", this.tags);
    }

}

window.smoozooPlugins = window.smoozooPlugins || {};
window.smoozooPlugins.SmoozooCollection = SmoozooCollection;
