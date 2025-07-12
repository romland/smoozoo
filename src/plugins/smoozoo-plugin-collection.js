/**
 * Smoozoo Collection Plugin
 *
 * This plugin transforms the Smoozoo viewer into a navigable gallery of images.
 */
export class SmoozooCollection
{
    constructor(api, options, targetElement) {
        this.api = api;
        this.options = options;
        this.gl = api.getGlContext();
        this.canvas = api.getCanvas();
        this.targetElement = targetElement;

        // --- Caching and Worker Setup ---
        this.cache = new ThumbnailCache(); // ✅ ADD THIS LINE
        this.worker = new Worker(new URL('../js/thumbnail.worker.js', import.meta.url));
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
            cols: options.cols || 5,                     // For masonry mode
            maxRowWidth: options.maxRowWidth || 8000,    // For row mode
            minWorldHeight: options.minWorldHeight || 0,
            maxWorldHeight: options.maxWorldHeight || 0,
        };

        // --- State ---
        this.images = []; // { id, src, thumbTex, x, y, width, height }
        this.worldSize = { width: 0, height: 0 };
        this.selection = new Set();
        this.isDraggingSelection = false;
        this.selectionBox = null;
        this.lastMouseWorldPos = { x: 0, y: 0 };
        this.isSelectModeActive = false;

        this.imageLoadQueue = new Set(); // Tracks images that need loading

        // --- Tagging ---
        this.db = new LocalStorageDB('smoozoo_tags');
        this.tags = this.db.getAll() || {};

        this.init();
    }

    init() {
        console.log("🖼️ Smoozoo Collection Plugin Initializing (Responsive)...");
        this.api.preventInitialLoad();
        this.api.overrideRenderer(this.render.bind(this));
        this.addKeyListeners();
        this.injectUI();

        this.images = this.config.images.map(imgData => ({
            ...imgData,
            filename: imgData.highRes.split('/').pop().split('?')[0],
            state: 'placeholder',
            thumbTex: null,
            width: this.config.thumbnailSize, 
            height: this.config.thumbnailSize * 1.25, // Estimate as portrait
            x: 0, y: 0
        }));

        // The initial layout will be recalculated on the first resize event anyway,
        // but we run it once to have something to show.
        this.calculateLayout();
        this.api.setWorldSize(this.worldSize);
        this.api.jumpToOrigin(0, 0); 
        this.api.requestRender();
    }

    onResize = () => {
        console.log("Recalculating layout due to resize...");
        this.calculateLayout();
        this.api.setWorldSize(this.worldSize);
        this.api.requestRender();
    }    

    // --- Core Logic ---
    async handleWorkerMessage(event) {
        const { status, imageUrl, pixelData, width, height, error } = event.data;
        
        // Here, imageUrl is the high-resolution URL
        const image = this.images.find(img => img.highRes === imageUrl);
        if (!image) return;

        if (status === 'success') {
            image.width = width;
            image.height = height;
            this.calculateLayout();

            this.api.setWorldSize(this.worldSize);

            image.thumbTex = this.createTextureFromPixels(pixelData, width, height);
            image.state = 'ready';

            // --- Caching and Uploading Logic ---
            const thumbBlob = await this.imageDataToBlob(pixelData);
            
            // 1. Save to IndexedDB
            this.cache.set(image.id, thumbBlob).catch(console.error);
            
            // 2. Optionally upload to server
            if (this.config.uploadConfig) {
                const formData = new FormData();
                formData.append('thumbnail', thumbBlob, `${image.id}.png`);
                formData.append('id', image.id);
                fetch(this.config.uploadConfig.url, {
                    method: 'POST',
                    body: formData,
                }).catch(console.error);
            }
            // ---

        } else {
            image.state = 'error';
        }
        this.api.requestRender();
    }

    async imageDataToBlob(imageData) {
        const canvas = new OffscreenCanvas(imageData.width, imageData.height);
        const ctx = canvas.getContext('2d');
        ctx.putImageData(imageData, 0, 0);
        return await canvas.convertToBlob({ type: 'image/png' });
    }    

    /**
     * NEW: Core lazy-loading function.
     * Handles the download and thumbnail generation for one image.
     */
    async requestImageLoad(image) {
        if (image.state !== 'placeholder') return;

        // Mark as loading to prevent duplicate requests
        image.state = 'loading';
        this.api.requestRender();

        // --- PRIORITY 1: Use pre-generated low-res thumbnail if available ---
        if (image.lowRes) {
            // Here, we load the low-res image directly, bypassing the worker.
            // This logic can be implemented similarly to how the worker fetches,
            // but for simplicity, we'll let it fall through for now.
            // A full implementation would fetch image.lowRes here.
        }

        // --- PRIORITY 2: Check IndexedDB cache ---
        const cachedBlob = await this.cache.get(image.id);
        if (cachedBlob) {
            const bmp = await createImageBitmap(cachedBlob);
            image.width = bmp.width;
            image.height = bmp.height;
            this.calculateLayout();
            image.thumbTex = this.createTextureFromImageBitmap(bmp);
            image.state = 'ready';
            this.api.requestRender();
            return; // Done!
        }

        // --- PRIORITY 3: Fallback to the worker to generate a new thumbnail ---
        this.worker.postMessage({
            imageUrl: image.highRes, // Send high-res URL to worker
            thumbnailSize: this.config.thumbnailSize,
        });
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

            const tempSmoozooApi = window.smoozoo(src, { canvas: tempCanvas, loadingAnimation: false, plugins: [] });
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
                
                // ✅ FIX: Use drawImage, which respects the flip transform
                flipCtx.drawImage(imageBitmap, 0, 0);

                flipCtx.restore();
                // --- END: Corrected Image Flip Logic ---

                const thumbTex = this.createTextureFromPixels(flipCanvas, thumbWidth, thumbHeight);
                
                this.images.push({
                    id: src, src, thumbTex,
                    x: 0, y: 0,
                    width: thumbWidth,
                    height: thumbHeight
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

        // 1. Create a new WebGL texture object.
        const texture = gl.createTexture();

        // 2. Bind the texture to the 2D texture unit.
        gl.bindTexture(gl.TEXTURE_2D, texture);

        // 3. Upload the ImageBitmap data to the texture.
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);

        // 4. Generate mipmaps for better quality when scaled down.
        gl.generateMipmap(gl.TEXTURE_2D);

        // 5. Set texture parameters for wrapping and filtering.
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        // 6. Unbind the texture to be safe.
        gl.bindTexture(gl.TEXTURE_2D, null);

        // 7. Return the finished texture.
        return texture;
    }

    __OLD__calculateLayout() {
        const { cols, padding, thumbnailSize } = this.config;
        let currentX = padding;
        let currentY = padding;
        let row = 0;

        this.images.forEach((img, index) => {
            const col = index % cols;
            if (col === 0 && index > 0) {
                row++;
            }
            img.x = col * (thumbnailSize + padding) + padding;
            img.y = row * (thumbnailSize + padding) + padding;
        });

        this.worldSize.width = cols * (thumbnailSize + padding) + padding;
        const numRows = Math.ceil(this.images.length / cols);
        this.worldSize.height = numRows * (thumbnailSize + padding) + padding;
    }

    __OLD2__calculateLayout() {
        const { cols, padding } = this.config;
        const colWidth = (this.canvas.width - (padding * (cols + 1))) / cols;
        
        // Track the current Y position for each column
        const columnHeights = Array(cols).fill(padding);
        
        this.images.forEach(img => {
            // Scale the image to fit the column width
            const scaleRatio = colWidth / img.width;
            const imgHeight = img.height * scaleRatio;

            // Find the shortest column to place the next image
            let shortestColumnIndex = 0;
            for (let i = 1; i < cols; i++) {
                if (columnHeights[i] < columnHeights[shortestColumnIndex]) {
                    shortestColumnIndex = i;
                }
            }

            // Set the image's position and dimensions
            img.x = padding + shortestColumnIndex * (colWidth + padding);
            img.y = columnHeights[shortestColumnIndex];
            img.width = colWidth;
            img.height = imgHeight;

            // Update the height of the column where the image was placed
            columnHeights[shortestColumnIndex] += imgHeight + padding;
        });

        // The world size is determined by the fixed width and the tallest column
        this.worldSize.width = this.canvas.width;
        this.worldSize.height = Math.max(...columnHeights);
    }    


    __OLD3__calculateLayout()
    {
        const { padding, maxRowWidth, minWorldHeight, maxWorldHeight } = this.config;
        const targetRowHeight = this.config.thumbnailSize;

        let x = padding;
        let y = padding;
        let currentRowMaxHeight = 0;

        this.images.forEach(img => {
            // Scale the image to the target row height, preserving aspect ratio
            const scaleRatio = targetRowHeight / img.height;
            const imgWidth = img.width * scaleRatio;

            // If adding this image exceeds the max width, wrap to the next row
            if (x + imgWidth + padding > maxRowWidth) {
                y += currentRowMaxHeight + padding;
                x = padding;
                currentRowMaxHeight = 0;
            }

            // Set image position and dimensions
            img.x = x;
            img.y = y;
            img.width = imgWidth;
            img.height = targetRowHeight; // All images in a row have same height

            // Update cursors for next image
            x += imgWidth + padding;
            if (targetRowHeight > currentRowMaxHeight) {
                currentRowMaxHeight = targetRowHeight;
            }
        });

        // Final world dimensions
        let finalHeight = y + currentRowMaxHeight + padding;
        
        // Enforce Min/Max Height Constraints
        if (minWorldHeight && finalHeight < minWorldHeight) {
            finalHeight = minWorldHeight;
        }
        if (maxWorldHeight && finalHeight > maxWorldHeight) {
            finalHeight = maxWorldHeight;
        }

        this.worldSize = { width: maxRowWidth, height: finalHeight };
    }

    __OLD4__calculateLayout() {
        const { padding, maxRowWidth } = this.config;
        const targetRowHeight = this.config.thumbnailSize;

        if (!this.images.length) {
            this.worldSize = { width: maxRowWidth, height: 0 };
            return;
        }

        const rows = [];
        let currentRow = [];
        let currentRowWidth = 0;

        // --- Step 1: Group images into rows ---
        this.images.forEach(img => {
            // All images are scaled to the same target height to create uniform rows
            const scaleRatio = targetRowHeight / img.height;
            const scaledWidth = img.width * scaleRatio;

            // If the current row is full, finalize it and start a new one
            if (currentRow.length > 0 && (currentRowWidth + scaledWidth + padding) > maxRowWidth) {
                rows.push(currentRow);
                currentRow = [];
                currentRowWidth = 0;
            }

            currentRow.push({ imgRef: img, width: scaledWidth, height: targetRowHeight });
            currentRowWidth += scaledWidth + padding;
        });
        if (currentRow.length > 0) {
            rows.push(currentRow); // Add the final, potentially incomplete row
        }

        // --- Step 2: Calculate final X/Y positions from the grouped rows ---
        let yCursor = padding;
        rows.forEach(row => {
            let xCursor = padding;
            let rowHeight = 0;

            row.forEach(item => {
                const { imgRef, width, height } = item;

                // Assign the final, calculated position to the original image object
                imgRef.x = xCursor;
                imgRef.y = yCursor;
                imgRef.width = width;
                imgRef.height = height;

                xCursor += width + padding;
                if (height > rowHeight) {
                    rowHeight = height; // Track the max height of the row
                }
            });
            yCursor += rowHeight + padding;
        });

        this.worldSize = { width: maxRowWidth, height: yCursor };
    }

    __OLD5__calculateLayout() {
        const { cols, padding } = this.config;
        // Calculate column width based on the CURRENT canvas width
        const colWidth = (this.canvas.width - (padding * (cols + 1))) / cols;
        
        const columnHeights = Array(cols).fill(padding);
        
        this.images.forEach(img => {
            // Scale the image's height based on its real aspect ratio to fit the column width
            const scaleRatio = colWidth / img.width;
            const imgHeight = img.height * scaleRatio;

            let shortestColumnIndex = 0;
            columnHeights.forEach((h, i) => {
                if (h < columnHeights[shortestColumnIndex]) {
                    shortestColumnIndex = i;
                }
            });

            img.x = padding + shortestColumnIndex * (colWidth + padding);
            img.y = columnHeights[shortestColumnIndex];
            img.width = colWidth; // All images have the same width in a column
            img.height = imgHeight;

            columnHeights[shortestColumnIndex] += imgHeight + padding;
        });

        this.worldSize.width = this.canvas.width;
        this.worldSize.height = Math.max(...columnHeights);
    }


    calculateLayout() {
        if (!this.images.length) return;

        // --- Option A: Masonry (Column-based) Layout ---
        if (this.config.layoutMode === 'masonry') {
            const { cols, padding } = this.config;
            const colWidth = (this.canvas.width - (padding * (cols + 1))) / cols;
            const columnHeights = Array(cols).fill(padding);
            
            this.images.forEach(img => {
                const scaleRatio = colWidth / img.width;
                const imgHeight = img.height * scaleRatio;

                let shortestColumnIndex = 0;
                columnHeights.forEach((h, i) => {
                    if (h < columnHeights[shortestColumnIndex]) {
                        shortestColumnIndex = i;
                    }
                });

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
            const { padding, thumbnailSize, maxRowWidth } = this.config;
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
    }


    createTextureFromPixels(pixelData, width, height) {
        const gl = this.gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);

        // The worker gives us a perfectly oriented image, so no flipping needed.
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixelData);

        gl.generateMipmap(gl.TEXTURE_2D); // Optional: for smoother minification
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        return texture;
    }

    render() {
        const { scale, originX, originY } = this.api.getTransform();
        const gl = this.gl;
        
        const program = this.api.getProgram();
        const buffers = this.api.getBuffers();
        const attribLocations = this.api.getAttribLocations();
        const uniformLocations = this.api.getUniformLocations();

        gl.useProgram(program);
        gl.clearColor(0.055, 0.016, 0.133, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // -- Setup Attributes --
        gl.enableVertexAttribArray(attribLocations.position);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
        gl.vertexAttribPointer(attribLocations.position, 2, gl.FLOAT, false, 0, 0);

        gl.enableVertexAttribArray(attribLocations.texcoord);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.texcoord);
        gl.vertexAttribPointer(attribLocations.texcoord, 2, gl.FLOAT, false, 0, 0);

        // -- Setup Uniforms --
        const viewProjMtx = this.api.makeMatrix(originX, originY, scale);
        gl.uniformMatrix3fv(uniformLocations.viewProjection, false, viewProjMtx);
        
        const identityMatrix = [1, 0, 0, 0, 1, 0, 0, 0, 1];
        gl.uniformMatrix3fv(uniformLocations.rotation, false, identityMatrix);

        gl.uniform2f(uniformLocations.texCoordScale, 1, 1);
        
        // -- Draw image thumbnails or placeholders --
        const viewX = -originX;
        const viewY = -originY;
        const viewWidth = this.canvas.width / scale;
        const viewHeight = this.canvas.height / scale;

        const renderBuffer = viewWidth * 1.5; // Load images 1.5 screen-widths away
        const bufferedViewX = viewX - renderBuffer;
        const bufferedViewWidth = viewWidth + (renderBuffer * 2);

        this.images.forEach(img => {
            // Check if the image is within the *buffered* viewport
            const isVisible = (
                img.x < bufferedViewX + bufferedViewWidth &&
                img.x + img.width > bufferedViewX &&
                img.y < viewY + viewHeight &&
                img.y + img.height > viewY
            );

            if (isVisible) {
                // If the image is a placeholder and in the buffered view, request it
                if (img.state === 'placeholder') {
                    this.requestImageLoad(img);
                }

                if (img.state === 'ready' && img.thumbTex) {
                    // Draw the real thumbnail (no change to this part)
                    gl.bindTexture(gl.TEXTURE_2D, img.thumbTex);
                    this.api.setRectangle(gl, img.x, img.y, img.width, img.height);
                    gl.drawArrays(gl.TRIANGLES, 0, 6);
                } else {
                    // Draw placeholder if needed
                }
            }
        });

        // -- Draw selection box overlay --
        const selectionDiv = document.getElementById('smoozoo-selection-box');
        if (this.isDraggingSelection && this.selectionBox) {
            const canvasRect = this.canvas.getBoundingClientRect();
            const screenStartX = (this.selectionBox.startX + originX) * scale + canvasRect.left;
            const screenStartY = (this.selectionBox.startY + originY) * scale + canvasRect.top;
            const screenEndX = (this.lastMouseWorldPos.x + originX) * scale + canvasRect.left;
            const screenEndY = (this.lastMouseWorldPos.y + originY) * scale + canvasRect.top;

            selectionDiv.style.left = `${Math.min(screenStartX, screenEndX)}px`;
            selectionDiv.style.top = `${Math.min(screenStartY, screenEndY)}px`;
            selectionDiv.style.width = `${Math.abs(screenEndX - screenStartX)}px`;
            selectionDiv.style.height = `${Math.abs(screenEndY - screenStartY)}px`;
            selectionDiv.style.display = 'block';
        } else {
            selectionDiv.style.display = 'none';
        }
    }


    // --- Event Handlers ---
    addKeyListeners() {
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Shift') {
                this.isSelectModeActive = true;
                this.canvas.style.cursor = 'crosshair';
            }
        });

        window.addEventListener('keyup', (e) => {
            if (e.key === 'Shift') {
                this.isSelectModeActive = false;
                this.canvas.style.cursor = 'grab';
            }
        });
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
            this.selectionBox = { startX: this.lastMouseWorldPos.x, startY: this.lastMouseWorldPos.y };
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
            this.lastMouseWorldPos = { x: worldX, y: worldY };
        }
    }

    // --- UI and Actions ---

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

// Simple wrapper for localStorage to act as a key-value store
class LocalStorageDB {
    constructor(dbName) {
        this.dbName = dbName;
    }
    getAll() {
        try {
            return JSON.parse(localStorage.getItem(this.dbName));
        } catch (e) {
            return null;
        }
    }
    setAll(data) {
        localStorage.setItem(this.dbName, JSON.stringify(data));
    }
}

class ThumbnailCache {
    constructor(dbName = 'smoozoo-thumb-cache', storeName = 'thumbnails') {
        this.dbName = dbName;
        this.storeName = storeName;
        this.db = null;
    }

    async open() {
        return new Promise((resolve, reject) => {
            if (this.db) {
                resolve(this.db);
                return;
            }
            const request = indexedDB.open(this.dbName, 1);
            request.onerror = () => reject("Error opening IndexedDB.");
            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                db.createObjectStore(this.storeName);
            };
        });
    }

    async get(key) {
        await this.open();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(this.storeName, 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(key);
            request.onerror = () => reject("Error getting item from cache.");
            request.onsuccess = () => resolve(request.result);
        });
    }

    async set(key, value) {
        await this.open();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(this.storeName, 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.put(value, key);
            request.onerror = () => reject("Error setting item in cache.");
            request.onsuccess = () => resolve(request.result);
        });
    }
}


// Make the plugin discoverable by Smoozoo
window.smoozooPlugins = window.smoozooPlugins || {};
window.smoozooPlugins.SmoozooCollection = SmoozooCollection;