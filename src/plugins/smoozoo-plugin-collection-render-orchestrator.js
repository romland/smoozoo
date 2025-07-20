/**
 * Manages all frame-by-frame rendering operations for the collection.
 * It separates the "what to draw" logic from the "how to draw" implementation.
 */
export class RenderOrchestrator {
    constructor(plugin) {
        this.plugin = plugin;
        this.api = plugin.api;
        this.gl = plugin.gl;
        this.canvas = plugin.canvas;
        this.config = plugin.config;
    }

    /**
     * The main entry point for rendering a single frame. Orchestrates all steps.
     */
    renderFrame() {
        if (!this.plugin.quadtree) return; // Not ready yet

        // 1. Prepare WebGL state for this frame (programs, buffers, etc.)
        const shaderInfo = this._prepareFrame();

        // 2. Calculate what's currently in the viewport and what's important.
        const viewState = this._calculateViewState();
        if (!viewState) return;

        // 3. Update the main plugin's state (e.g., which image is under the cursor).
        this.plugin.imageUnderCursor = viewState.imageUnderCursor;
        
        // 4. Perform logical actions based on the view state (e.g., queueing new images).
        this._processImages(viewState);

        // 5. Draw the scene to the canvas.
        this._drawScene(viewState, shaderInfo);

        // 6. Update any out-of-canvas UI elements.
        this._updateUI(viewState);
    }

    /**
     * Sets up the initial WebGL state for the frame.
     * @returns {object} Information about the shaders and GL state.
     */
    _prepareFrame() {
        const { gl, api } = this;
        const program = api.getProgram();
        gl.useProgram(program);
        gl.clearColor(0.055, 0.016, 0.133, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        const attribLocations = api.getAttribLocations();
        const buffers = api.getBuffers();
        gl.enableVertexAttribArray(attribLocations.position);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
        gl.vertexAttribPointer(attribLocations.position, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(attribLocations.texcoord);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.texcoord);
        gl.vertexAttribPointer(attribLocations.texcoord, 2, gl.FLOAT, false, 0, 0);

        const { originX, originY, scale } = api.getTransform();
        const uniformLocations = api.getUniformLocations();
        const mainViewProjMtx = api.makeMatrix(originX, originY, scale);
        gl.uniformMatrix3fv(uniformLocations.viewProjection, false, mainViewProjMtx);

        const identityMatrix = [1, 0, 0, 0, 1, 0, 0, 0, 1];
        gl.uniformMatrix3fv(uniformLocations.rotation, false, identityMatrix);
        gl.uniform2f(uniformLocations.texCoordScale, 1, 1);
        
        return {
            program,
            uniformLocations,
            filter: api.getSettings().pixelatedZoom ? gl.NEAREST : gl.LINEAR
        };
    }

    /**
     * Calculates the current viewport, queries the quadtree, and determines
     * which images are visible, which is dominant, and which is under the cursor.
     * @returns {object|null} A state object for the current frame, or null if not ready.
     */
    _calculateViewState() {
        const { scale, originX, originY } = this.api.getTransform();
        const viewWidth = this.canvas.width / scale;
        const viewHeight = this.canvas.height / scale;
        const viewX = -originX;
        const viewY = -originY;

        // Define the area to query, including a buffer around the viewport
        const verticalBuffer = viewHeight * this.config.loadBuffer;
        const horizontalBuffer = viewWidth * this.config.loadBuffer;
        const loadArea = {
            x: viewX - horizontalBuffer,
            y: viewY - verticalBuffer,
            width: viewWidth + horizontalBuffer * 2,
            height: viewHeight + verticalBuffer * 2,
        };

        const potentialImages = this.plugin.quadtree.query(loadArea, scale);
        const visibleImages = [];
        let imageUnderCursor = null;

        // Filter potential images down to what's actually visible
        for (const img of potentialImages) {
            const isVisible = (
                img.x < viewX + viewWidth && img.x + img.width > viewX &&
                img.y < viewY + viewHeight && img.y + img.height > viewY
            );
            img.isVisible = isVisible; // Mark for prioritizing network requests
            if (isVisible) {
                visibleImages.push(img);
                // Check if this visible image is under the mouse
                if (
                    this.plugin.lastMouseWorldPos.x >= img.x &&
                    this.plugin.lastMouseWorldPos.x <= img.x + img.width &&
                    this.plugin.lastMouseWorldPos.y >= img.y &&
                    this.plugin.lastMouseWorldPos.y <= img.y + img.height
                ) {
                    imageUnderCursor = img;
                }
            }
        }
        
        // Find the single image taking up the most screen area
        let dominantImg = null;
        let maxVisibleArea = 0;
        for (const img of visibleImages) {
            const intersectX = Math.max(img.x, viewX);
            const intersectY = Math.max(img.y, viewY);
            const intersectRight = Math.min(img.x + img.width, viewX + viewWidth);
            const intersectBottom = Math.min(img.y + img.height, viewY + viewHeight);
            const currentVisibleArea = Math.max(0, intersectRight - intersectX) * Math.max(0, intersectBottom - intersectY);

            if (currentVisibleArea > maxVisibleArea) {
                maxVisibleArea = currentVisibleArea;
                dominantImg = img;
            }
        }

        return {
            scale, originX, originY,
            potentialImages, visibleImages,
            imageUnderCursor, dominantImg
        };
    }

    /**
     * Handles non-drawing logic, such as queueing thumbnails for loading
     * and managing high-resolution image requests.
     * @param {object} viewState The calculated state for the current frame.
     */
    _processImages(viewState) {
        // Queue thumbnails that are inside the buffered load area
        for (const img of viewState.potentialImages) {
            if (img.state === 'placeholder' && !this.plugin.requestQueue.some(req => req.id === img.id)) {
                this.plugin.requestQueue.push(img);
            }
        }
        this.plugin.processRequestQueue();

        // Manage high-resolution loading for the dominant image
        clearTimeout(this.plugin.highResLoadDebounceTimer);
        const { dominantImg, scale } = viewState;

        if (dominantImg && dominantImg.state === 'ready' && scale > this.config.highResThreshold) {
            if (dominantImg.highResState === 'none') {
                const screenWidth = dominantImg.width * scale;
                const isDominantOnScreen = (screenWidth / this.canvas.width) >= this.config.instantLoadThreshold;

                if (isDominantOnScreen) {
                    this.plugin.requestHighResLoad(dominantImg); // Load immediately
                } else {
                    // Otherwise, wait briefly to see if the user stops moving
                    this.plugin.highResLoadDebounceTimer = setTimeout(() => {
                        const { scale: currentScale } = this.api.getTransform();
                        if (currentScale > this.config.highResThreshold) {
                            this.plugin.requestHighResLoad(dominantImg);
                        }
                    }, this.config.highResLoadDelay);
                }
            }
        }
    }

    /**
     * Draws all visible images to the canvas.
     * @param {object} viewState The calculated state for the current frame.
     * @param {object} shaderInfo Information about the current shader program.
     */
    _drawScene(viewState, shaderInfo) {
        for (const img of viewState.visibleImages) {
            if (!img.thumbTex) continue; // Don't draw if the thumbnail texture isn't even ready

            // Apply dimming effect for selected images
            const brightnessLocation = this.gl.getUniformLocation(shaderInfo.program, "u_brightness");
            this.gl.uniform1f(brightnessLocation, this.plugin.selectionDeck.isSelected(img.id) ? 0.5 : 1.0);

            // Decide whether to draw the high-res or thumbnail version
            let drawn = false;
            if (img.highResState === 'ready' && (img.highResTexture || img.highResTiles)) {
                this.plugin.updateCacheUsage(img); // Mark as recently used
                drawn = this._drawHighRes(img, shaderInfo.filter);
            }
            
            // Fallback to drawing the thumbnail
            if (!drawn) {
                this._drawThumbnail(img, shaderInfo.filter);
            }
        }
    }

    /**
     * Draws the high-resolution version of an image, handling both single
     * and tiled textures. It correctly calculates the aspect ratio.
     * @param {object} img The image object to draw.
     * @param {GLenum} filter The WebGL magnification filter to use.
     * @returns {boolean} True if the image was successfully drawn.
     */
    _drawHighRes(img, filter) {
        // Calculate the "letterboxed" or "pillarboxed" rectangle
        const boxAspect = img.width / img.height;
        const imageAspect = img.originalWidth / img.originalHeight;
        let finalWidth, finalHeight, offsetX, offsetY;

        if (imageAspect > boxAspect) { // Image is wider than the container
            finalWidth = img.width;
            finalHeight = img.width / imageAspect;
            offsetX = 0;
            offsetY = (img.height - finalHeight) / 2;
        } else { // Image is taller or same aspect
            finalHeight = img.height;
            finalWidth = img.height * imageAspect;
            offsetY = 0;
            offsetX = (img.width - finalWidth) / 2;
        }
        
        const finalRect = {
            x: img.x + offsetX,
            y: img.y + offsetY,
            width: finalWidth,
            height: finalHeight
        };

        if (img.highResTexture) {
            this.gl.bindTexture(this.gl.TEXTURE_2D, img.highResTexture);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, filter);
            this.api.setRectangle(this.gl, finalRect.x, finalRect.y, finalRect.width, finalRect.height);
            this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
            return true;
        }
        
        if (img.highResTiles) {
            const tileScaleFactor = finalWidth / img.originalWidth;
            for (const tile of img.highResTiles) {
                this.gl.bindTexture(this.gl.TEXTURE_2D, tile.texture);
                this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, filter);
                const tileX = finalRect.x + (tile.x * tileScaleFactor);
                const tileY = finalRect.y + (tile.y * tileScaleFactor);
                const tileWidth = tile.width * tileScaleFactor;
                const tileHeight = tile.height * tileScaleFactor;
                this.api.setRectangle(this.gl, tileX, tileY, tileWidth, tileHeight);
                this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
            }
            return true;
        }

        return false;
    }
    
    /**
     * Draws the low-resolution thumbnail for an image.
     * @param {object} img The image object to draw.
     * @param {GLenum} filter The WebGL magnification filter to use.
     */
    _drawThumbnail(img, filter) {
        this.gl.bindTexture(this.gl.TEXTURE_2D, img.thumbTex);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, filter);
        this.api.setRectangle(this.gl, img.x, img.y, img.width, img.height);
        this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
    }
    
    /**
     * Updates the separate HTML info label based on the dominant image.
     * @param {object} viewState The calculated state for the current frame.
     */
    _updateUI(viewState) {
        const { dominantImg, scale, originX, originY } = viewState;

        if (dominantImg && dominantImg.highResState === 'ready' && scale > this.config.highResThreshold) {
            // This logic is duplicated from _drawHighRes, but is necessary here
            // to calculate the final screen position for the DOM element.
            const boxAspect = dominantImg.width / dominantImg.height;
            const imageAspect = dominantImg.originalWidth / dominantImg.originalHeight;
            let finalWidth, finalHeight, offsetX, offsetY;

            if (imageAspect > boxAspect) {
                finalWidth = dominantImg.width;
                finalHeight = dominantImg.width / imageAspect;
                offsetX = 0;
                offsetY = (dominantImg.height - finalHeight) / 2;
            } else {
                finalHeight = dominantImg.height;
                finalWidth = dominantImg.height * imageAspect;
                offsetY = 0;
                offsetX = (dominantImg.width - finalWidth) / 2;
            }

            this.plugin.infoLabel.update({
                image: dominantImg,
                dimensions: { finalWidth, finalHeight, offsetX, offsetY },
                transform: { scale, originX, originY },
                canvas: this.canvas,
                config: this.config
            });
        } else {
            // If conditions aren't met, tell the label to hide.
            this.plugin.infoLabel.update({});
        }
    }
}
