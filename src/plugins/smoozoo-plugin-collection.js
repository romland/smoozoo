/**
 * Smoozoo Collection Plugin
 *
 * This plugin transforms the Smoozoo viewer into a navigable gallery of images.
 */
import { ThumbnailCache, LocalStorageDB, Quadtree } from './smoozoo-plugin-collection-helpers.js';
import { SelectionDeck } from './smoozoo-plugin-collection-selectiondeck.js';

export class SmoozooCollection
{
    constructor(api, options, targetElement) {
        this.api = api;
        this.options = options;
        this.gl = api.getGlContext();
        this.canvas = api.getCanvas();
        this.targetElement = targetElement;

        // --- Caching and Worker Setup ---
        this.cache = new ThumbnailCache();
        this.worker = new Worker(new URL('../js/thumbnail.worker.js',
            import.meta.url));
        this.worker.onmessage = this.handleWorkerMessage.bind(this);

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
        };

        // --- State ---
        this.images = []; // { id, src, thumbTex, x, y, width, height }
        this.highResLoadDebounceTimer = null; // to hold timer ID
        this.worldSize = {
            width: 0,
            height: 0
        };
        this.selection = new Set();
        this.isDraggingSelection = false;
        this.selectionBox = null;
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

        this.requestQueue = []; // Holds images waiting to be loaded
        this.currentlyProcessing = 0; // Count of active network requests

        // --- Tagging ---
        this.db = new LocalStorageDB('smoozoo_tags');
        this.tags = this.db.getAll() || {};

        this.init();

        // Now that the main images are loaded, tell the deck to load its saved state.
        this.selectionDeck.loadSelection();
    }

    init() {
        console.log("🖼️ Smoozoo Collection Plugin Initializing...");
        this.api.preventInitialLoad();
        this.api.overrideRenderer(this.render.bind(this));

        this.selectionDeck = new SelectionDeck(this, this.config.deckConfig, this.targetElement);
        this.selectionDeck.init();
        this.injectFocusUI();

        this.addKeyListeners();
        this.injectUI();

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
                y: 0
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
        // --- 1. Setup ---
        const {
            scale,
            originX,
            originY
        } = this.api.getTransform();
        const gl = this.gl;
        const canvas = this.canvas;
        const smoozooSettings = this.api.getSettings();
        const filter = smoozooSettings.pixelatedZoom ? gl.NEAREST : gl.LINEAR;
        const program = this.api.getProgram();
        const buffers = this.api.getBuffers();
        const attribLocations = this.api.getAttribLocations();
        const uniformLocations = this.api.getUniformLocations();
        
        gl.useProgram(program);
        gl.clearColor(0.055, 0.016, 0.133, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enableVertexAttribArray(attribLocations.position);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
        gl.vertexAttribPointer(attribLocations.position, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(attribLocations.texcoord);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.texcoord);
        gl.vertexAttribPointer(attribLocations.texcoord, 2, gl.FLOAT, false, 0, 0);
        
        const mainViewProjMtx = this.api.makeMatrix(originX, originY, scale);
        gl.uniformMatrix3fv(uniformLocations.viewProjection, false, mainViewProjMtx);
        const identityMatrix = [1, 0, 0, 0, 1, 0, 0, 0, 1];
        gl.uniformMatrix3fv(uniformLocations.rotation, false, identityMatrix);
        gl.uniform2f(uniformLocations.texCoordScale, 1, 1);
        
        // --- 2. Calculate Query Area ---
        const viewWidth = canvas.width / scale;
        const viewHeight = canvas.height / scale;
        const viewX = -originX;
        const viewY = -originY;
        
        const verticalBuffer = viewHeight * this.config.loadBuffer;
        const horizontalBuffer = viewWidth * this.config.loadBuffer;
        const loadArea = {
            x: viewX - horizontalBuffer,
            y: viewY - verticalBuffer,
            width: viewWidth + horizontalBuffer * 2,
            height: viewHeight + verticalBuffer * 2,
        };
        
        // Abort if the quadtree isn't ready
        if (!this.quadtree) {
            return;
        }
        
        // --- 3. Query Quadtree for Relevant Images ---
        const potentialImages = this.quadtree.query(loadArea, scale);
        
        // --- 4. Process Images ---
        // Find visible images and the specific image under the mouse cursor
        const visibleImages = [];
        let newImageUnderCursor = null;
        
        for (const img of potentialImages) {
            // Check which of the potential images are actually visible to draw
            const isVisible = (
                img.x < viewX + viewWidth && img.x + img.width > viewX &&
                img.y < viewY + viewHeight && img.y + img.height > viewY
            );
            img.isVisible = isVisible; // For network queue prioritization
            
            if (isVisible) {
                visibleImages.push(img);
                // Check if this image contains the last known mouse position
                if (
                    this.lastMouseWorldPos.x >= img.x &&
                    this.lastMouseWorldPos.x <= img.x + img.width &&
                    this.lastMouseWorldPos.y >= img.y &&
                    this.lastMouseWorldPos.y <= img.y + img.height
                ) {
                    newImageUnderCursor = img;
                }
            }
            
            // If an image is in the load area and is a placeholder, queue it
            if (img.state === 'placeholder') {
                const isQueued = this.requestQueue.some(req => req.id === img.id);
                if (!isQueued) {
                    this.requestQueue.push(img);
                }
            }
        }
        
        this.imageUnderCursor = newImageUnderCursor;
        
        // --- 5. High-Resolution Logic ---
        // Always clear any high-res load request that was scheduled in the previous frame.
        clearTimeout(this.highResLoadDebounceTimer);
        
        if (this.imageUnderCursor) {
            if (this.imageUnderCursor.state === 'ready' && scale > this.config.highResThreshold) {
                if (this.imageUnderCursor.highResState === 'none') {
                    // Check if the image's width OR height dominates the corresponding canvas dimension.
                    const imageScreenWidth = this.imageUnderCursor.width * scale;
                    const imageScreenHeight = this.imageUnderCursor.height * scale;
                    
                    const isDominantOnScreen =
                        (imageScreenWidth / this.canvas.width >= this.config.instantLoadThreshold) ||
                        (imageScreenHeight / this.canvas.height >= this.config.instantLoadThreshold);
                    
                    if (isDominantOnScreen) {
                        // Bypass the debounce and load the high-res version immediately.
                        this.requestHighResLoad(this.imageUnderCursor);
                    } else {
                        // The user is likely panning. Use the timeout to prevent choppiness.
                        this.highResLoadDebounceTimer = setTimeout(() => {
                            const {
                                scale: currentScale
                            } = this.api.getTransform();
                            if (currentScale > this.config.highResThreshold) {
                                this.requestHighResLoad(this.imageUnderCursor);
                            }
                        }, this.config.highResLoadDelay);
                    }
                }
            }
        }
        
        // --- 6. Draw Visible Images ---
        for (const img of visibleImages) {
            let textureToDisplay = img.thumbTex;
            if (!textureToDisplay) continue; // Don't draw if texture isn't ready

            // --- NEW: On-Canvas Selection Indicator ---
            // Get the location of the new 'u_brightness' uniform from your shader.
            const brightnessLocation = gl.getUniformLocation(program, "u_brightness");
            if (this.selectionDeck.isSelected(img.id)) {
                gl.uniform1f(brightnessLocation, 0.5); // Dim selected images
            } else {
                gl.uniform1f(brightnessLocation, 1.0); // Full brightness for others
            }

            let drawn = false;

            if (img === this.imageUnderCursor && img.highResState === 'ready' && (img.highResTexture || img.highResTiles)) {
                this.updateCacheUsage(img);
                
                if (img.highResTexture) {
                    const boxAspect = img.width / img.height;
                    const imageAspect = img.originalWidth / img.originalHeight;
                    let finalWidth, finalHeight, offsetX, offsetY;
                    
                    if (imageAspect > boxAspect) { // Image is wider than the box
                        finalWidth = img.width;
                        finalHeight = img.width / imageAspect;
                        offsetX = 0;
                        offsetY = (img.height - finalHeight) / 2;
                    } else { // Image is taller than the box
                        finalHeight = img.height;
                        finalWidth = img.height * imageAspect;
                        offsetY = 0;
                        offsetX = (img.width - finalWidth) / 2;
                    }
                    
                    gl.bindTexture(gl.TEXTURE_2D, img.highResTexture);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
                    this.api.setRectangle(gl, img.x + offsetX, img.y + offsetY, finalWidth, finalHeight);
                    gl.drawArrays(gl.TRIANGLES, 0, 6);
                    drawn = true; // Mark as drawn to prevent the default renderer from running
                } else if (img.highResTiles) {
                    
                    const boxAspect = img.width / img.height;
                    const imageAspect = img.originalWidth / img.originalHeight;
                    let finalWidth, finalHeight, offsetX, offsetY;
                    if (imageAspect > boxAspect) {
                        finalWidth = img.width;
                        finalHeight = img.width / imageAspect;
                        offsetX = 0;
                        offsetY = (img.height - finalHeight) / 2;
                    } else {
                        finalHeight = img.height;
                        finalWidth = img.height * imageAspect;
                        offsetY = 0;
                        offsetX = (img.width - finalWidth) / 2;
                    }
                    const tileScaleFactor = finalWidth / img.originalWidth;
                    for (const tile of img.highResTiles) {
                        gl.bindTexture(gl.TEXTURE_2D, tile.texture);
                        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
                        const tileX = img.x + offsetX + (tile.x * tileScaleFactor);
                        const tileY = img.y + offsetY + (tile.y * tileScaleFactor);
                        const tileWidth = tile.width * tileScaleFactor;
                        const tileHeight = tile.height * tileScaleFactor;
                        this.api.setRectangle(gl, tileX, tileY, tileWidth, tileHeight);
                        gl.drawArrays(gl.TRIANGLES, 0, 6);
                    }
                    drawn = true;
                }
            }
            
            if (!drawn && textureToDisplay) {
                gl.bindTexture(gl.TEXTURE_2D, textureToDisplay);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
                this.api.setRectangle(gl, img.x, img.y, img.width, img.height);
                gl.drawArrays(gl.TRIANGLES, 0, 6);
            }
        }
        
        // --- 7. Final Processing and UI ---
        this.processRequestQueue();
        
        // Update the position of the focus highlight UI element
        this.updateFocusHighlight();
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

    handleSelectAction() {
        // Now selects the image under the cursor
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
        // Only start drag-to-select if Shift key is held down
        if (this.isSelectModeActive) {
            if (e.button !== 0) return true;
            this.isDraggingSelection = true;
            this.selectionBox = {
                startX: this.lastMouseWorldPos.x,
                startY: this.lastMouseWorldPos.y
            };
            this.api.cancelAllAnimations();
            return false; // Prevent panning
        }
        // If Shift is not held, let the default panning behavior pass through
        return true;
    }

    onDrag = (e) => {
        if (!this.isDraggingSelection) return true;
        this.updateSelection();
        this.api.requestRender();
        return false;
    }

    onMouseUp = (e) => {
        if (!this.isDraggingSelection) return true;
        this.isDraggingSelection = false;
        this.updateSelection(true);
        this.api.requestRender();
        this.updateActionUI();
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

    // --- UI and Actions ---

    /**
     * Injects a div used to highlight the currently focused image.
     */
    injectFocusUI() {
        const html = `<div id="smoozoo-focus-highlight"></div>`;
        this.targetElement.insertAdjacentHTML('beforeend', html);
        const highlightStyle = document.getElementById('smoozoo-focus-highlight').style;
        highlightStyle.position = 'absolute';
        highlightStyle.display = 'none';
        highlightStyle.border = `3px solid ${this.config.focusHighlightColor}`;
        highlightStyle.borderRadius = '5px';
        highlightStyle.zIndex = '50';
        highlightStyle.pointerEvents = 'none';
        highlightStyle.transition = 'all 0.15s ease-out';
    }

    /**
     * Updates the position and size of the focus highlight div in the render loop.
     */
    updateFocusHighlight() {
        const highlightDiv = document.getElementById('smoozoo-focus-highlight');
        // Now highlights the image under the cursor
        if (this.imageUnderCursor) {
            const { scale, originX, originY } = this.api.getTransform();
            const canvasRect = this.canvas.getBoundingClientRect();
            
            const screenX = (this.imageUnderCursor.x + originX) * scale + canvasRect.left;
            const screenY = (this.imageUnderCursor.y + originY) * scale + canvasRect.top;
            const screenWidth = this.imageUnderCursor.width * scale;
            const screenHeight = this.imageUnderCursor.height * scale;
            
            highlightDiv.style.display = 'block';
            highlightDiv.style.left = `${screenX - 3}px`;
            highlightDiv.style.top = `${screenY - 3}px`;
            highlightDiv.style.width = `${screenWidth}px`;
            highlightDiv.style.height = `${screenHeight}px`;

        } else {
            highlightDiv.style.display = 'none';
        }
    }


    injectUI() {
        const html = `
            <div id="smoozoo-collection-actions" class="smoozoo-ui-panel">
                <h3>Collection</h3>
                <div id="smoozoo-selection-info">No items selected</div>
                <div id="smoozoo-action-buttons">
                    <button data-action="tag">Tag Selected</button>
                    <button data-action="clear">Clear Selection</button>
                </div>
            </div>
            <div id="smoozoo-selection-box"></div>
        `;
        this.targetElement.insertAdjacentHTML('beforeend', html);

        document.getElementById('smoozoo-action-buttons').addEventListener('click', e => {
            const action = e.target.dataset.action;
            if (action === 'tag') this.handleTagAction();
            if (action === 'clear') this.clearSelection();
        });
    }

    updateActionUI() {
        const info = document.getElementById('smoozoo-selection-info');
        info.textContent = `${this.selection.size} item(s) selected`;
    }

    updateSelection(isFinal = false) {
        if (!this.selectionBox) return;
        if (!isFinal) this.selection.clear(); // Recalculate on each drag frame

        const box = {
            x1: Math.min(this.selectionBox.startX, this.lastMouseWorldPos.x),
            y1: Math.min(this.selectionBox.startY, this.lastMouseWorldPos.y),
            x2: Math.max(this.selectionBox.startX, this.lastMouseWorldPos.x),
            y2: Math.max(this.selectionBox.startY, this.lastMouseWorldPos.y)
        };

        this.images.forEach(img => {
            // AABB intersection test
            if (img.x < box.x2 && img.x + img.width > box.x1 &&
                img.y < box.y2 && img.y + img.height > box.y1) {
                this.selection.add(img.id);
            }
        });
    }

    clearSelection() {
        this.selection.clear();
        this.updateActionUI();
        this.api.requestRender();
    }

    // --- Tagging Logic ---

    handleTagAction() {
        if (this.selection.size === 0) {
            alert("Please select one or more images to tag.");
            return;
        }

        const newTags = prompt("Enter tags, separated by commas:", "");
        if (newTags === null || newTags.trim() === '') return;

        const tagsToAdd = newTags.split(',').map(t => t.trim()).filter(Boolean);

        this.selection.forEach(imgId => {
            if (!this.tags[imgId]) this.tags[imgId] = [];
            const tagSet = new Set(this.tags[imgId]);
            tagsToAdd.forEach(tag => tagSet.add(tag));
            this.tags[imgId] = [...tagSet];
        });

        this.db.setAll(this.tags);
        alert(`Tags added to ${this.selection.size} images.`);
        console.log("Updated Tags DB:", this.tags);
    }
}

window.smoozooPlugins = window.smoozooPlugins || {};
window.smoozooPlugins.SmoozooCollection = SmoozooCollection;
