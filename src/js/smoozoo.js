window.smoozoo = (imageUrl, settings) => {
    // DOM Element Selection & Initial Setup
    // (rest of setup is at the bottom of this file)
    const canvas = settings.canvas;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    // We're requesting a 'webgl' context, which is WebGL 1.
    const gl = canvas.getContext('webgl');

    if (!gl) {
        alert("WebGL is not supported in your browser.");
        throw new Error("WebGL not supported");
    }

    const loader = document.getElementById('loader');

    const zoomLevelSpan = document.getElementById('zoom-level');
    const mouseCoordsSpan = document.getElementById('mouse-coords');
    const imageSizePixelsSpan = document.getElementById('image-size-pixels');
    const imageSizeBytesSpan = document.getElementById('image-size-bytes');
    const imageFilenameSpan = document.getElementById('image-file-name');

    const panSlider = document.getElementById('pan-slider');
    const minimapContainer = document.getElementById('minimap-container');
    const minimapImage = document.getElementById('minimap-image');
    const minimapViewport = document.getElementById('minimap-viewport');

    // State Variables
    let scale = 1.0,
        originX = 0,
        originY = 0;
    let tiles = [],
        panning = false;
    let startX = 0,
        startY = 0;

    // Variables for smooth zooming
    let targetScale = 1.0;
    let targetOriginX = 0;
    let targetOriginY = 0;

    let isZooming = false;
    let lastMouseX = 0;
    let lastMouseY = 0;

    // Variables for inertial panning
    let panVelocityX = 0;
    let panVelocityY = 0;
    let lastPanTime = 0;
    let currentInertiaFriction = settings.mouseInertiaFriction;

    // Variables for touch interaction
    let initialPinchDistance = 0;
    let initialScale = 1.0;
    let isTouching = false;
    let lastTap = 0;
    let tapTimeout;
    let touchStartX = 0;
    let touchStartY = 0;

    // Image properties
    let orgImgWidth = 0;
    let orgImgHeight = 0;
    let orgImgBytes = 0;
    let rotation = 0;
    let minScale = 0.1;

    // Animation state tracking
    let inertiaAnimationId = null;
    let elasticMoveAnimationId = null;
    let smoothZoomAnimationId = null;

    // Get the maximum dimension (width or height) for a texture that the user's GPU can handle.
    // This is a hardware limitation. If an image is larger than this size, we can't load it as a single
    // texture. This is the entire reason for the "tiling" logic in this application. We will slice the
    // large image into smaller pieces (tiles) that are each no larger than maxTextureSize.
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);

    // Plugins
    let plugins = settings.plugins || [];


    // ------------------------
    // --- Matrix Utilities ---
    // ------------------------

    // In 2D graphics with WebGL, we use 3x3 matrices to represent transformations like translation (moving),
    // rotation, and scaling. Even though we are in 2D, we use a 3x3 matrix (and vec3 in shaders) to
    // handle translations efficiently using a mathematical trick called "homogeneous coordinates".
    // The matrix is represented in JavaScript as a 9-element array in column-major order, which is
    // what WebGL expects.
    // A 3x3 matrix looks like this:
    // | m0 m3 m6 |
    // | m1 m4 m7 |
    // | m2 m5 m8 |
    // But in a JS array [m0, m1, m2, m3, m4, m5, m6, m7, m8] it's laid out column by column.    
    const mat3 = {
        /**
         * Multiplies two 3x3 matrices (a * b).
         * Matrix multiplication is how we combine transformations. For example, to rotate an object and then move it,
         * you would multiply its position by a rotation matrix, and then multiply the result by a translation matrix.
         * The order of multiplication is important! a * b is not the same as b * a.
         * @param {number[]} a The first matrix (e.g., a rotation matrix).
         * @param {number[]} b The second matrix (e.g., a translation matrix).
         * @returns {number[]} The resulting combined transformation matrix.
         */
        multiply: (a, b) => {
            // This is the standard mathematical formula for 3x3 matrix multiplication.
            const a00 = a[0], a01 = a[1], a02 = a[2], a10 = a[3], a11 = a[4], a12 = a[5], a20 = a[6], a21 = a[7], a22 = a[8];
            const b00 = b[0], b01 = b[1], b02 = b[2], b10 = b[3], b11 = b[4], b12 = b[5], b20 = b[6], b21 = b[7], b22 = b[8];
            return [
                b00 * a00 + b01 * a10 + b02 * a20, b00 * a01 + b01 * a11 + b02 * a21, b00 * a02 + b01 * a12 + b02 * a22,
                b10 * a00 + b11 * a10 + b12 * a20, b10 * a01 + b11 * a11 + b12 * a21, b10 * a02 + b11 * a12 + b12 * a22,
                b20 * a00 + b21 * a10 + b22 * a20, b20 * a01 + b21 * a11 + b22 * a21, b20 * a02 + b21 * a12 + b22 * a22
            ];
        },

        /**
         * Creates a translation matrix. When this matrix is multiplied by a vector, it moves it by tx and ty.
         * The resulting matrix is:
         * | 1  0  tx |
         * | 0  1  ty |
         * | 0  0  1  |
         */
        translation: (tx, ty) => [1, 0, 0, 0, 1, 0, tx, ty, 1],

        /**
         * Creates a 2D rotation matrix. When multiplied by a vector, it rotates the vector around the origin (0,0).
         * The resulting matrix is:
         * | cos(a)  -sin(a)  0 |
         * | sin(a)   cos(a)  0 |
         * |   0        0     1 |
         */
        rotation: (angleInRad) => {
            const c = Math.cos(angleInRad);
            const s = Math.sin(angleInRad);
            return [c, -s, 0, s, c, 0, 0, 0, 1];
        },
    };

    // ---------------------
    // --- WebGL Shaders ---
    // ---------------------

    /**
     * The Vertex Shader's primary job is to calculate the final position of each vertex.
     * It's updated to scale texture coordinates to account for POT padding.
     */
    const vertexShaderSource = `
        attribute vec2 a_position;
        attribute vec2 a_texcoord;

        uniform mat3 u_viewProjectionMatrix;
        uniform mat3 u_rotationMatrix;
        uniform vec2 u_texCoordScale; // NEW: Scales texture coordinates

        varying vec2 v_texcoord;

        void main() {
            vec3 rotated_position = u_rotationMatrix * vec3(a_position, 1.0);
            vec3 final_position = u_viewProjectionMatrix * vec3(rotated_position.xy, 1.0);

            gl_Position = vec4(final_position.xy, 0.0, 1.0);

            // Apply the texture coordinate scaling before passing to the fragment shader
            v_texcoord = a_texcoord * u_texCoordScale;
        }
    `;


    /**
     * The Fragment (or Pixel) Shader's job is to calculate the final color of each pixel on the screen
     * that is covered by our geometry. It runs once for every single pixel.
     */
    const fragmentShaderSource = `
        // Sets the default floating point precision for performance. 'mediump' is a good balance.
        precision mediump float;

        // Varyings (Input)
        // This receives the interpolated texture coordinate from the vertex shader. For a pixel in the middle
        // of our rectangle, this value might be (0.5, 0.5), for example.
        varying vec2 v_texcoord;

        // Uniforms (Input)
        // This represents the actual texture (our image tile) we want to draw.
        // 'sampler2D' is the GLSL type for a 2D texture.
        uniform sampler2D u_image;

        void main() {
            // Step 1: Sample the Texture
            // The texture2D function looks up a color from the texture (u_image) at a specific
            // coordinate (v_texcoord).
            
            // Step 2: Set Final Color
            // gl_FragColor is a special built-in variable that the fragment shader MUST set.
            // It determines the final color of the pixel as a RGBA (Red, Green, Blue, Alpha) vector.
            gl_FragColor = texture2D(u_image, v_texcoord);
        }
    `;

    // ------------------------------
    // --- WebGL Helper Functions ---
    // ------------------------------

    // Compiles a shader from its GLSL source code.
    function createShader(gl, type, source)
    {
        const shader = gl.createShader(type); // Create a new shader object (e.g., VERTEX_SHADER).
        gl.shaderSource(shader, source);      // Provide the GLSL source code.
        gl.compileShader(shader);             // Compile the shader.

        // Check if the compilation was successful. If not, log the error and clean up.
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error("Error compiling shader:", gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }


    // Links the compiled vertex and fragment shaders into a single "program".
    function createProgram(gl, vertexShader, fragmentShader)
    {
        const program = gl.createProgram(); // Create a new program object.
        gl.attachShader(program, vertexShader); // Attach both shaders.
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program); // Link them together.

        // Check if the linking was successful. If not, log the error and clean up.
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error("Error linking program:", gl.getProgramInfoLog(program));
            gl.deleteProgram(program); // Corrected from gl.deleteShader
            return null;
        }
        return program;
    }


    /**
     * Sets the vertex positions for a rectangle.
     * 
     * Fills the positionBuffer with the vertex coordinates for a rectangle.
     * WebGL draws triangles, not rectangles, so we define a rectangle using two triangles (6 vertices).
     * Triangle 1: (x1, y1), (x2, y1), (x1, y2)
     * Triangle 2: (x1, y2), (x2, y1), (x2, y2)
     */
    function setRectangle(gl, x, y, width, height)
    {
        const x1 = x, x2 = x + width, y1 = y, y2 = y + height;
        const positions = [x1, y1, x2, y1, x1, y2, x1, y2, x2, y1, x2, y2];

        // Bind the positionBuffer, making it the active buffer.
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

        // Upload the new vertex data to the GPU. gl.STATIC_DRAW is a hint that we don't expect this data to change frequently.
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
    }


    /**
     * Creates a view-projection matrix to transform from pixel space to clip space.
     * 
     * This is the most complex matrix here. Its job is to transform
     * coordinates from our "world space" (where the image lives, in pixels) toWebGL's "clip space"
     * (a -1 to +1 cube). This single matrix effectively handles panning (translation) and zooming (scaling).
     *
     * It maps the visible portion of our world (defined by originX/Y and scale) onto the clip space rectangle.
     *
     * The transformation involves a few steps which are combined into this one matrix:
     * 1. Translation: Move the world based on our pan position (originX, originY).
     * 2. Scaling: Scale the world based on our zoom level (scale).
     * 3. Projection: Convert from pixel coordinates to clip space coordinates (-1 to 1).
     */
    function makeMatrix(tx, ty, scale)
    {
        // This is a specialized matrix multiplication that combines scaling, translation, and projection.
        // It's equivalent to:
        //   let m = mat3.projection(canvas.width, canvas.height);
        //   m = mat3.translate(m, tx, ty);
        //   m = mat3.scale(m, scale, scale);
        // but is calculated directly for performance.

        // Scale x: maps pixel coordinates to the range -1 to 1.
        const m0 = scale * 2 / canvas.width;

        // Scale y: maps pixel coordinates to the range -1 to 1 (and flips the Y-axis, as WebGL's Y is up, canvas's is down).
        const m4 = scale * -2 / canvas.height;

        // Translate x: takes the scaled pan offset and moves the origin to the center.
        const m6 = (scale * 2 * tx / canvas.width) - 1;

        // Translate y: takes the scaled pan offset and moves the origin to the center.
        const m7 = (scale * -2 * ty / canvas.height) + 1;

        // The final 3x3 matrix in column-major order.
        return [ m0, 0, 0, 0, m4, 0, m6, m7, 1 ];
    }

    /**
     * Formats a number of bytes into a human-readable string (KB, MB, GB, etc.).
     */
    function formatBytes(bytes, d = 2)
    {
        if (bytes === 0)
            return '0 B';

        const k = 1024,
                dm = d < 0 ? 0 : d,
                s = ['B', 'KB', 'MB', 'GB', 'TB'],
                i = Math.floor(Math.log(bytes) / Math.log(k));

        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + s[i];
    }


    /**
     * Calculates the next highest power of two for a given number.
     * e.g., nextPowerOf2(600) will return 1024.
     */
    function nextPowerOf2(n) {
        if (n > 0 && (n & (n - 1)) === 0) {
            return n; // Already a power of two
        }
        let p = 1;
        while (p < n) {
            p <<= 1; // Bitwise left shift (p = p * 2)
        }
        return p;
    }


    /**
     * Loads an image, pads each tile to be power-of-two, and creates WebGL textures with Mipmaps.
     */
    async function loadImageAndCreateTextureInfo(url, callback)
    {
        loader.classList.remove('hidden');

        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const blob = await response.blob();
            orgImgBytes = blob.size;
            const objectURL = URL.createObjectURL(blob);

            const img = new Image();
            img.crossOrigin = "anonymous";
            img.src = objectURL;

            img.onload = function() {
                orgImgWidth = img.width;
                orgImgHeight = img.height;
                generateMinimapThumbnail(img);

                const numXTiles = Math.ceil(img.width / maxTextureSize);
                const numYTiles = Math.ceil(img.height / maxTextureSize);

                for (let y = 0; y < numYTiles; y++) {
                    for (let x = 0; x < numXTiles; x++) {
                        const sx = x * maxTextureSize,
                              sy = y * maxTextureSize,
                              sw = Math.min(maxTextureSize, img.width - sx),
                              sh = Math.min(maxTextureSize, img.height - sy);

                        // 1. Create a canvas with the tile's actual dimensions
                        const tileCanvas = document.createElement('canvas');
                        tileCanvas.width = sw;
                        tileCanvas.height = sh;
                        const tileCtx = tileCanvas.getContext('2d');
                        tileCtx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

                        // 2. Create a new canvas with power-of-two dimensions
                        const potCanvas = document.createElement('canvas');
                        potCanvas.width = nextPowerOf2(sw);
                        potCanvas.height = nextPowerOf2(sh);
                        const potCtx = potCanvas.getContext('2d');
                        potCtx.drawImage(tileCanvas, 0, 0); // Draw the tile onto the larger canvas

                        // 3. Calculate the texture coordinate scaling factor
                        const texCoordScaleX = sw / potCanvas.width;
                        const texCoordScaleY = sh / potCanvas.height;

                        // --- WebGL Texture Creation ---
                        const texture = gl.createTexture();
                        gl.bindTexture(gl.TEXTURE_2D, texture);

                        // 4. Use the padded, power-of-two canvas to create the texture
                        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, potCanvas);
                        gl.generateMipmap(gl.TEXTURE_2D);

                        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
                        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

                        // 5. Store the scaling factors with the tile data
                        tiles.push({
                            texture,
                            x: sx,
                            y: sy,
                            width: sw,
                            height: sh,
                            texCoordScaleX,
                            texCoordScaleY
                        });
                    }
                }

                imageFilenameSpan.textContent = url.split('/').pop();
                URL.revokeObjectURL(objectURL);
                callback();
            };
        } catch (error) {
            console.error("Failed to load image:", error);
            alert("Failed to load image.");
        }
    }


    /**
     * The main rendering loop. This function is called every time the view needs to be redrawn
     * (e.g., during panning, zooming, or animation).
     */
    function render()
    {
        if (!tiles.length) {
            return;
        }

        gl.clearColor(0.055, 0.016, 0.133, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBuffer);
        gl.enableVertexAttribArray(texcoordLocation);
        gl.vertexAttribPointer(texcoordLocation, 2, gl.FLOAT, false, 0, 0);

        const angleInRad = rotation * Math.PI / 180;
        let rotMtx = mat3.translation(orgImgWidth / 2, orgImgHeight / 2);
        rotMtx = mat3.multiply(rotMtx, mat3.rotation(angleInRad));
        rotMtx = mat3.multiply(rotMtx, mat3.translation(-orgImgWidth / 2, -orgImgHeight / 2));
        gl.uniformMatrix3fv(rotationMatrixLocation, false, rotMtx);

        const viewProjMtx = makeMatrix(originX, originY, scale);
        gl.uniformMatrix3fv(viewProjectionMatrixLocation, false, viewProjMtx);

        // --- View Frustum Culling ---
        // Calculate the visible boundary of the viewport in world coordinates.
        // The origin is the top-left of the image, but originX/Y is how much we've panned the image
        // relative to the top-left of the canvas. So, the visible world area starts at -originX.
        const viewX = -originX;
        const viewY = -originY;
        const viewWidth = canvas.width / scale;
        const viewHeight = canvas.height / scale;

        tiles.forEach(tile => {
            // Check if the tile's bounding box intersects with the visible area.
            // This is an Axis-Aligned Bounding Box (AABB) intersection test.
            // It works by checking if the tile's rectangle and the view's rectangle overlap.
            // We don't need to account for rotation here, as the culling is done on the original
            // tile positions before they are rotated by the vertex shader on the GPU.
            if (tile.x < viewX + viewWidth &&
                tile.x + tile.width > viewX &&
                tile.y < viewY + viewHeight &&
                tile.y + tile.height > viewY)
            {
                gl.bindTexture(gl.TEXTURE_2D, tile.texture);
                
                // --- Set the texture coordinate scale for this specific tile ---
                gl.uniform2f(texCoordScaleLocation, tile.texCoordScaleX, tile.texCoordScaleY);

                setRectangle(gl, tile.x, tile.y, tile.width, tile.height);
                gl.drawArrays(gl.TRIANGLES, 0, 6);
            }
        });

        zoomLevelSpan.textContent = scale.toFixed(2);
        updatePanSlider();
        updateMinimap();

        if(plugins.length) {
            for(const plugin of plugins) {
                plugin.instance?.update();
            }
        }
    }


    // ---------------------------
    // --- Animation Functions ---
    // ---------------------------

    function cancelAllAnimations()
    {
        if (inertiaAnimationId) {
            cancelAnimationFrame(inertiaAnimationId);
            inertiaAnimationId = null;
        }

        if (elasticMoveAnimationId) {
            cancelAnimationFrame(elasticMoveAnimationId);
            elasticMoveAnimationId = null;
        }

        if (smoothZoomAnimationId) {
            cancelAnimationFrame(smoothZoomAnimationId);
            smoothZoomAnimationId = null;
        }

        isZooming = false;
    }


    /**
     * Smoothly animates the view to a new origin point with an ease-out effect.
     */
    function elasticMove(toX, toY)
    {
        cancelAllAnimations();

        const easeOutCubic = (t) => (--t) * t * t + 1;
        let duration = settings.elasticMoveDuration;
        let startTime = performance.now();
        const fromX = originX;
        const fromY = originY;

        function animate(time)
        {
            let t = Math.min((time - startTime) / duration, 1);
            originX = fromX + (toX - fromX) * easeOutCubic(t);
            originY = fromY + (toY - fromY) * easeOutCubic(t);
            render();
            if (t < 1) {
                elasticMoveAnimationId = requestAnimationFrame(animate);
            } else {
                elasticMoveAnimationId = null;
            }
        }

        elasticMoveAnimationId = requestAnimationFrame(animate);
    }


    /**
     * Gets the current image dimensions, accounting for rotation.
     */
    function getCurrentImageSize()
    {
        const i = rotation === 90 || rotation === 270;
        return {
            width: i ? orgImgHeight : orgImgWidth,
            height: i ? orgImgWidth : orgImgHeight
        };
    }


    /**
     * Checks if the view is outside the image boundaries and corrects it.
     */
    function checkEdges(elasticSnap = true)
    {
        const { width: imageWidth, height: imageHeight } = getCurrentImageSize();
        const viewWidth = canvas.width / scale;
        const viewHeight = canvas.height / scale;

        let targetX = originX;
        let targetY = originY;

        if (imageWidth < viewWidth) {
            targetX = (viewWidth - imageWidth) / 2;
        } else {
            const minOriginX = viewWidth - imageWidth;
            if (originX > 0) targetX = 0;
            if (originX < minOriginX) targetX = minOriginX;
        }

        if (imageHeight < viewHeight) {
            targetY = (viewHeight - imageHeight) / 2;
        } else {
            const minOriginY = viewHeight - imageHeight;
            if (originY > 0) targetY = 0;
            if (originY < minOriginY) targetY = minOriginY;
        }

        if (targetX !== originX || targetY !== originY) {
            if (elasticSnap) {
                elasticMove(targetX, targetY);
            } else {
                originX = targetX;
                originY = targetY;
                render();
            }
        }
    }

    /**
     * Linear interpolation
     */
    function lerp(s, e, a)
    {
        return (1 - a) * s + a * e;
    }


    /**
     * Smoothly interpolates the scale and origin to their target values.
     */
    function smoothZoomLoop()
    {
        isZooming = true;

        const smoothing = settings.zoomSmoothing;
        scale = lerp(scale, targetScale, smoothing);
        originX = lerp(originX, targetOriginX, smoothing);
        originY = lerp(originY, targetOriginY, smoothing);
        render();

        const scaleDiff = Math.abs(scale - targetScale);
        const originXDiff = Math.abs(originX - targetOriginX);
        const originYDiff = Math.abs(originY - targetOriginY);

        if (scaleDiff < 0.001 && originXDiff < 0.001 && originYDiff < 0.001) {
            scale = targetScale;
            originX = targetOriginX;
            originY = targetOriginY;
            isZooming = false;
            smoothZoomAnimationId = null;
            render();
            checkEdges(false);
        } else {
            smoothZoomAnimationId = requestAnimationFrame(smoothZoomLoop);
        }
    }


    /**
     * Simulates inertial movement, but stops and hands off to checkEdges
     * as soon as a boundary is crossed.
     */
    function inertiaLoop(vx, vy, friction)
    {
        const newVx = vx * friction;
        const newVy = vy * friction;

        const stopThreshold = settings.inertiaStopThreshold || 0.1;

        if (Math.abs(newVx) < stopThreshold && Math.abs(newVy) < stopThreshold) {
            inertiaAnimationId = null;
            checkEdges();
            return;
        }

        originX += newVx / scale;
        originY += newVy / scale;

        const { width: imageWidth, height: imageHeight } = getCurrentImageSize();
        const viewWidth = canvas.width / scale;
        const viewHeight = canvas.height / scale;

        let isOutOfBounds = false;
        if (imageWidth > viewWidth) {
            if (originX > 0 || originX < viewWidth - imageWidth) {
                isOutOfBounds = true;
            }
        }
        if (imageHeight > viewHeight) {
            if (originY > 0 || originY < viewHeight - imageHeight) {
                isOutOfBounds = true;
            }
        }
        
        render();

        if (isOutOfBounds) {
            inertiaAnimationId = null;
            checkEdges(); 
        } else {
            inertiaAnimationId = requestAnimationFrame(() => inertiaLoop(newVx, newVy, friction));
        }
    }


    function debounce(func, timeout = 100)
    {
        let timer;

        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                func.apply(this, args);
            }, timeout);
        };
    }


    /**
     * Generates a small thumbnail for the minimap from the full-sized image.
     */
    function generateMinimapThumbnail(image)
    {
        const MAX_SIZE = settings.minimapMaxSize;
        const MIN_SIZE = settings.minimapMinSize;

        const thumbCanvas = document.createElement('canvas');
        const thumbCtx = thumbCanvas.getContext('2d');
        const aspect = image.width / image.height;

        if (aspect > 1) {
            thumbCanvas.width = MAX_SIZE;
            thumbCanvas.height = MAX_SIZE / aspect;
        } else {
            thumbCanvas.height = MAX_SIZE;
            thumbCanvas.width = MAX_SIZE * aspect;
        }

        thumbCtx.drawImage(image, 0, 0, thumbCanvas.width, thumbCanvas.height);
        const dataUrl = thumbCanvas.toDataURL('image/jpeg', 0.8);
        minimapImage.style.backgroundImage = `url(${dataUrl})`;

        let containerWidth, containerHeight;
        if (aspect > 1) {
            containerWidth = MAX_SIZE;
            containerHeight = containerWidth / aspect;
        } else {
            containerHeight = MAX_SIZE;
            containerWidth = containerHeight * aspect;
        }

        containerWidth = Math.max(containerWidth, MIN_SIZE);
        containerHeight = Math.max(containerHeight, MIN_SIZE);
        minimapContainer.style.width = containerWidth + 'px';
        minimapContainer.style.height = containerHeight + 'px';
        minimapContainer.style.display = 'block';
    }


    /**
     * Updates the position and size of the viewport indicator on the minimap.
     */
    function updateMinimap()
    {
        if (!orgImgWidth) {
            return;
        }

        const { width: imageWidth, height: imageHeight } = getCurrentImageSize();
        const viewWidth = canvas.width / scale;
        const viewHeight = canvas.height / scale;

        const imgRect = {
            x: 0,
            y: 0,
            width: imageWidth,
            height: imageHeight
        };

        const viewRect = {
            x: -originX,
            y: -originY,
            width: viewWidth,
            height: viewHeight
        };

        const intersectX = Math.max(imgRect.x, viewRect.x);
        const intersectY = Math.max(imgRect.y, viewRect.y);
        const intersectRight = Math.min(imgRect.x + imgRect.width, viewRect.x + viewRect.width);
        const intersectBottom = Math.min(imgRect.y + imgRect.height, viewRect.y + viewRect.height);
        const intersectWidth = intersectRight - intersectX;
        const intersectHeight = intersectBottom - intersectY;

        if (intersectWidth < 0 || intersectHeight < 0) {
            minimapViewport.style.width = '0px';
            minimapViewport.style.height = '0px';
            return;
        }

        const ratio = minimapContainer.clientWidth / imageWidth;
        minimapViewport.style.left = `${intersectX * ratio}px`;
        minimapViewport.style.top = `${intersectY * ratio}px`;
        minimapViewport.style.width = `${intersectWidth * ratio}px`;
        minimapViewport.style.height = `${intersectHeight * ratio}px`;
    }


    function jumpToOrigin(targetOriginX, targetOriginY)
    {
        cancelAllAnimations();

        const { width: imageWidth, height: imageHeight } = getCurrentImageSize();
        const viewWidth = canvas.width / scale;
        const viewHeight = canvas.height / scale;

        if (imageWidth > viewWidth) {
            originX = Math.max(viewWidth - imageWidth, Math.min(0, targetOriginX));
        } else {
            originX = (viewWidth - imageWidth) / 2;
        }

        if (imageHeight > viewHeight) {
            originY = Math.max(viewHeight - imageHeight, Math.min(0, targetOriginY));
        } else {
            originY = (viewHeight - imageHeight) / 2;
        }

        render();
    }


    function calculateTargetOriginForMinimapEvent(e)
    {
        const { width: imageWidth, height: imageHeight } = getCurrentImageSize();
        const rect = minimapContainer.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;
        const targetWorldX = (clickX / rect.width) * imageWidth;
        const targetWorldY = (clickY / rect.height) * imageHeight;
        const viewWidth = canvas.width / scale;
        const viewHeight = canvas.height / scale;
        const targetOriginX = (viewWidth / 2) - targetWorldX;
        const targetOriginY = (viewHeight / 2) - targetWorldY;

        return {
            targetOriginX,
            targetOriginY
        };
    }


    function setInitialView()
    {
        if (!orgImgWidth) {
            return;
        }

        const { width: imageWidth, height: imageHeight } = getCurrentImageSize();
        const scaleToFitWidth = canvas.width / imageWidth;
        const scaleToFitHeight = canvas.height / imageHeight;
        const fitScale = Math.min(scaleToFitWidth, scaleToFitHeight);

        scale = targetScale = Math.min(1.0, fitScale);

        minScale = Math.min(scale, 0.1);

        if(settings.initialScale) {
            scale = targetScale = settings.initialScale;
        }

        
        if (settings.initialPosition && typeof settings.initialPosition.x === 'number' && typeof settings.initialPosition.y === 'number') {
            let targetX = settings.initialPosition.x;
            let targetY = settings.initialPosition.y;

            // If coordinates are between 0 and 1, treat them as percentages
            if (targetX >= 0 && targetX <= 1 && targetY >= 0 && targetY <= 1) {
                targetX = imageWidth * targetX;
                targetY = imageHeight * targetY;
            }

            // Calculate origin to center the view on the target coordinates
            originX = (canvas.width / (2 * scale)) - targetX;
            originY = (canvas.height / (2 * scale)) - targetY;

            // Also set the target origin for the smooth zoom animation state
            targetOriginX = originX;
            targetOriginY = originY;
        }

        checkEdges(false);
    }


    function createPluginInstance(ClassName, api, options)
    {
        return new ClassName(api, options);
    }


    // ----------------------
    // --- Event Handlers ---
    // ----------------------

    // ------------------------------------
    // --- Mouse Event Wrappers -----------
    // ------------------------------------

    function handleCanvasMouseDown(e) {
        cancelAllAnimations();
        panning = true;
        panVelocityX = 0;
        panVelocityY = 0;
        startX = (e.clientX / scale) - originX;
        startY = (e.clientY / scale) - originY;
        touchStartX = e.clientX;
        touchStartY = e.clientY;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        window.addEventListener('mousemove', handleCanvasMouseMove);
        window.addEventListener('mouseup', handleCanvasMouseUp);
    }

    function handleCanvasMouseMove(e) {
        if (!panning) return;
        const deltaX = e.clientX - lastMouseX;
        const deltaY = e.clientY - lastMouseY;
        if (Math.abs(deltaX) > 0 || Math.abs(deltaY) > 0) {
            panVelocityX = deltaX;
            panVelocityY = deltaY;
        }
        originX = (e.clientX / scale) - startX;
        let newOriginY = (e.clientY / scale) - startY;
        const { height: imageHeight } = getCurrentImageSize();
        const viewHeight = canvas.height / scale;
        if (imageHeight < viewHeight) {
            newOriginY = (viewHeight - imageHeight) / 2;
        }
        originY = newOriginY;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        render();
    }

    function handleCanvasMouseUp(e) {
        if (!panning) return;
        window.removeEventListener('mousemove', handleCanvasMouseMove);
        window.removeEventListener('mouseup', handleCanvasMouseUp);
        
        if (panVelocityX !== 0 || panVelocityY !== 0) {
            cancelAllAnimations();

            // --- THIS IS THE FIX ---
            const { width: imageWidth, height: imageHeight } = getCurrentImageSize();
            const viewWidth = canvas.width / scale;
            const viewHeight = canvas.height / scale;

            // Only start the glide if the image is actually larger than the screen.
            if (imageWidth > viewWidth || imageHeight > viewHeight) {
                inertiaLoop(panVelocityX, panVelocityY, settings.mouseInertiaFriction);
            } else {
                // Otherwise, just snap it back to center immediately.
                checkEdges();
            }

        } else {
            checkEdges();
        }
        panning = false;
    }


    // ------------------------------------
    // --- Touch Event Wrappers -----------
    // ------------------------------------

    function handleTouchStart(e)
    {
        if (minimapContainer.contains(e.target)) {
            return;
        }

        e.preventDefault();
        cancelAllAnimations();
        isTouching = true;

        if (e.touches.length === 1) {
            panning = true;
            const touch = e.touches[0];
            panVelocityX = 0;
            panVelocityY = 0;
            startX = (touch.clientX / scale) - originX;
            startY = (touch.clientY / scale) - originY;
            touchStartX = touch.clientX;
            touchStartY = touch.clientY;
            lastMouseX = touch.clientX;
            lastMouseY = touch.clientY;
        } else if (e.touches.length === 2) {
            panning = false;
            const t1 = e.touches[0], t2 = e.touches[1];
            initialPinchDistance = Math.sqrt(Math.pow(t1.clientX - t2.clientX, 2) + Math.pow(t1.clientY - t2.clientY, 2));
            initialScale = scale;
            const midpointX = (t1.clientX + t2.clientX) / 2;
            const midpointY = (t1.clientY + t2.clientY) / 2;
            startX = (midpointX / scale) - originX;
            startY = (midpointY / scale) - originY;
        }
    }


    function handleTouchMove(e)
    {
        e.preventDefault();
        if (e.touches.length === 1 && panning) {
            const touch = e.touches[0];
            const deltaX = touch.clientX - lastMouseX;
            const deltaY = touch.clientY - lastMouseY;
            if (Math.abs(deltaX) > 0 || Math.abs(deltaY) > 0) {
                panVelocityX = deltaX;
                panVelocityY = deltaY;
            }
            originX = (touch.clientX / scale) - startX;
            let newOriginY = (touch.clientY / scale) - startY;
            const { height: imageHeight } = getCurrentImageSize();
            const viewHeight = canvas.height / scale;
            if (imageHeight < viewHeight) {
                newOriginY = (viewHeight - imageHeight) / 2;
            }
            originY = newOriginY;
            lastMouseX = touch.clientX;
            lastMouseY = touch.clientY;
            render();
        } else if (e.touches.length === 2 && isTouching) {
            const t1 = e.touches[0], t2 = e.touches[1];
            const currentPinchDistance = Math.sqrt(Math.pow(t1.clientX - t2.clientX, 2) + Math.pow(t1.clientY - t2.clientY, 2));
            if (initialPinchDistance > 0) {
                scale = Math.max(minScale, Math.min(initialScale * (currentPinchDistance / initialPinchDistance), 20));
            }
            const midpointX = (t1.clientX + t2.clientX) / 2;
            const midpointY = (t1.clientY + t2.clientY) / 2;
            originX = (midpointX / scale) - startX;
            originY = (midpointY / scale) - startY;
            render();
        }
    }

    function handleTouchEnd(e)
    {
        e.preventDefault();
        
        // If other fingers are still on the screen...
        if (e.touches.length > 0) {
            // If the gesture was a pinch (`panning` is false), don't
            // start a new pan. Just ignore this event and wait for the
            // final finger to be lifted off the screen.
            if (!panning) {
                return;
            }

            // If it was some other multi-touch event (like a 3-finger pan), reset it.
            handleTouchStart(e);
            return;
        }

        const endTouch = e.changedTouches[0];
        const now = performance.now();
        
        // Calculate the distance the finger moved from start to end.
        const distance = Math.sqrt(Math.pow(endTouch.clientX - touchStartX, 2) + Math.pow(endTouch.clientY - touchStartY, 2));

        // A "tap" is a touch that moved less than 15px.
        // We also check the `panning` flag. After a pinch, `panning` will be
        // false, which prevents this block from running and incorrectly toggling the UI.
        if (panning && distance < 15) {
            // This was a tap gesture
            const timesince = now - lastTap;

            // Check if this tap happened quickly after the last one.
            if (timesince > 0 && timesince < 300) {
                // Double tap: Cancel the pending single tap and handle as a double tap.
                clearTimeout(tapTimeout);
                handleDoubleTap(e);
            } else {
                // Single tap: Wait to see if another tap follows.
                tapTimeout = setTimeout(() => {
                    document.body.classList.toggle('ui-hidden');
                }, 300);
            }

            lastTap = now;

        } else {
            // This was a pan, flick, or the end of a pinch gesture
            cancelAllAnimations(); 

            const { width: imageWidth, height: imageHeight } = getCurrentImageSize();
            const viewWidth = canvas.width / scale;
            const viewHeight = canvas.height / scale;

            // Only start the glide if the image is actually larger than the screen.
            if (imageWidth > viewWidth || imageHeight > viewHeight) {
                if (panVelocityX !== 0 || panVelocityY !== 0) {
                    inertiaLoop(panVelocityX, panVelocityY, settings.touchInertiaFriction);
                } else {
                    checkEdges();
                }
            } else {
                // Otherwise, just snap it back to center immediately.
                checkEdges();
            }
        }
        
        // Reset gesture state.
        panning = false;
        isTouching = false;
    }


    function handleDoubleTap(e)
    {
        // This reuses a lot of logic from your dblclick handler
        cancelAllAnimations();

        // Find the tap coordinates. Use changedTouches for the 'up' event.
        const touch = e.changedTouches[0];
        lastMouseX = touch.clientX;
        lastMouseY = touch.clientY;

        // Toggle between fit-to-screen scale and a deeper zoom level
        const { width: imageWidth, height: imageHeight } = getCurrentImageSize();
        const fitScale = Math.min(canvas.width / imageWidth, canvas.height / imageHeight);
        const isFit = Math.abs(scale - fitScale) < 0.01;
        
        targetScale = isFit ? 1.5 : fitScale; // Zoom to 150% or back to fit

        // The rest of the logic is the same as handleCanvasDoubleClick
        // Calculate world coordinates and new origin to zoom to the tapped point
        const worldMouseX = (lastMouseX / scale) - originX;
        const worldMouseY = (lastMouseY / scale) - originY;
        targetOriginX = (lastMouseX / targetScale) - worldMouseX;
        targetOriginY = (lastMouseY / targetScale) - worldMouseY;

        // Trigger the smooth zoom animation
        if (!isZooming) {
            smoothZoomAnimationId = requestAnimationFrame(smoothZoomLoop);
        }
    }


    function handleCanvasWheel(e)
    {
        e.preventDefault();
        cancelAllAnimations();

        const zoomFactor = 1.1;
        const scaleAmount = e.deltaY > 0 ? 1 / zoomFactor : zoomFactor;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;

        const newTargetScale = targetScale * scaleAmount;
        // Clamp the target scale
        targetScale = Math.max(minScale, Math.min(newTargetScale, 20));

        // Calculate the raw target origin based on mouse position
        const worldMouseX = (lastMouseX / scale) - originX;
        const worldMouseY = (lastMouseY / scale) - originY;
        const rawTargetOriginX = (lastMouseX / targetScale) - worldMouseX;
        const rawTargetOriginY = (lastMouseY / targetScale) - worldMouseY;

        // Apply edge-snapping logic directly to the TARGET values before animating
        const { width: imageWidth, height: imageHeight } = getCurrentImageSize();
        const viewWidthAtTarget = canvas.width / targetScale;
        const viewHeightAtTarget = canvas.height / targetScale;

        if (imageWidth < viewWidthAtTarget) {
            // If image is narrower than viewport, center it
            targetOriginX = (viewWidthAtTarget - imageWidth) / 2;
        } else {
            // Otherwise, clamp it within the horizontal bounds
            const minOriginX = viewWidthAtTarget - imageWidth;
            targetOriginX = Math.max(minOriginX, Math.min(0, rawTargetOriginX));
        }

        if (imageHeight < viewHeightAtTarget) {
            // If image is shorter than viewport, center it
            targetOriginY = (viewHeightAtTarget - imageHeight) / 2;
        } else {
            // Otherwise, clamp it within the vertical bounds
            const minOriginY = viewHeightAtTarget - imageHeight;
            targetOriginY = Math.max(minOriginY, Math.min(0, rawTargetOriginY));
        }

        if (!isZooming) {
            smoothZoomAnimationId = requestAnimationFrame(smoothZoomLoop);
        }
    }


    function handleCanvasDoubleClick(e)
    {
        e.preventDefault();
        cancelAllAnimations();

        let finalScale = (Math.abs(scale - 1.0) < 0.01) ? 0.25 : 1;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        targetScale = finalScale;

        const worldMouseX = (lastMouseX / scale) - originX;
        const worldMouseY = (lastMouseY / scale) - originY;
        const rawTargetOriginX = (lastMouseX / targetScale) - worldMouseX;
        const rawTargetOriginY = (lastMouseY / targetScale) - worldMouseY;
        const { width: imageWidth, height: imageHeight } = getCurrentImageSize();

        const viewWidthAtTarget = canvas.width / targetScale;
        if (imageWidth < viewWidthAtTarget) {
            targetOriginX = (viewWidthAtTarget - imageWidth) / 2;
        } else {
            const minOriginX = viewWidthAtTarget - imageWidth;
            targetOriginX = Math.max(minOriginX, Math.min(0, rawTargetOriginX));
        }

        const viewHeightAtTarget = canvas.height / targetScale;
        if (imageHeight < viewHeightAtTarget) {
            targetOriginY = (viewHeightAtTarget - imageHeight) / 2;
        } else {
            const minOriginY = viewHeightAtTarget - imageHeight;
            targetOriginY = Math.max(minOriginY, Math.min(0, rawTargetOriginY));
        }

        if (!isZooming) {
            smoothZoomAnimationId = requestAnimationFrame(smoothZoomLoop);
        }
    }


    function handleWindowKeyDown(e)
    {
        const { width: imageWidth, height: imageHeight } = getCurrentImageSize();
        const viewWidth = canvas.width / scale;
        const viewHeight = canvas.height / scale;
        let targetX = originX,
            targetY = originY,
            needsMove = false,
            needsRender = false;

        switch (e.key) {
            case 'Home':
                if (imageWidth > viewWidth) {
                    targetX = 0;
                    needsMove = true;
                }
                break;

            case 'End':
                if (imageWidth > viewWidth) {
                    targetX = viewWidth - imageWidth;
                    needsMove = true;
                }
                break;

            case 'PageUp':
                if (imageHeight > viewHeight) {
                    targetY = 0;
                    needsMove = true;
                }
                break;

            case 'PageDown':
                if (imageHeight > viewHeight) {
                    targetY = viewHeight - imageHeight;
                    needsMove = true;
                }
                break;

            case 'm':
                e.preventDefault();
                document.body.classList.toggle('ui-hidden');
                break;

            case 'r':
            case 'R':
                if (e.ctrlKey) break;
                e.preventDefault();
                rotation = (rotation + 90) % 360;
                checkEdges(false);
                needsRender = true;
                break;

            default:
                return;
        }

        if (needsMove) {
            e.preventDefault();
            elasticMove(targetX, targetY);
        } else if (needsRender) {
            render();
        }
    }


    function handleDocumentMouseLeave()
    {
        if(panning) {
            handleCanvasMouseUp();
        }
    }


    function updatePanSlider()
    {
        const { width: imageWidth } = getCurrentImageSize();
        const viewWidth = canvas.width / scale;
        const isPannable = imageWidth > viewWidth;

        panSlider.disabled = !isPannable;

        if (isPannable) {
            const minOriginX = viewWidth - imageWidth;
            if (minOriginX >= 0) {
                panSlider.value = 0;
                return;
            }
            const percent = originX / minOriginX;
            panSlider.value = percent * 100;
        } else {
            panSlider.value = 0;
        }
    }


    function handleSliderInput()
    {
        const { width: imageWidth } = getCurrentImageSize();
        const viewWidth = canvas.width / scale;
        const minOriginX = viewWidth - imageWidth;

        // Lock the scale and Y-axis to their current values
        targetScale = scale;
        targetOriginY = originY; 

        targetOriginX = minOriginX * (panSlider.value / 100);

        if (!isZooming) {
            requestAnimationFrame(smoothZoomLoop);
        }
    }


    function handleCanvasMousePositionStatus(e)
    {
        const { width: iw, height: ih } = getCurrentImageSize();
        const x = Math.max(0, Math.min(iw, Math.floor((e.clientX / scale) - originX))),
                y = Math.max(0, Math.min(ih, Math.floor((e.clientY / scale) - originY)));
        mouseCoordsSpan.textContent = `${x},${y}`;
        
        // --- PLUGIN HOOK ---
        // Let the plugin know where the mouse is
        if(plugins.length) {
            for(const plugin of plugins) {
                plugin.instance?.onMouseMove(e);
            }
        }
    }


    function handleWindowResize()
    {
        // Capture the state
        const oldWidth = canvas.width;
        const oldHeight = canvas.height;

        // Find what world coordinate is currently at the center of the viewport.
        // This is the point we want to keep centered after the resize.
        const centerWorldX = (oldWidth / (2 * scale)) - originX;
        const centerWorldY = (oldHeight / (2 * scale)) - originY;

        // Perform the actual resize ---
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        gl.viewport(0, 0, canvas.width, canvas.height);

        // Recalculate the origin to re-center the view ---
        // We use our saved world coordinate and the new canvas size to find the
        // new originX/Y needed to keep that point in the middle of the screen.
        originX = (canvas.width / (2 * scale)) - centerWorldX;
        originY = (canvas.height / (2 * scale)) - centerWorldY;
        
        // Also update the target origins for the smooth zoom animation state to avoid conflicts.
        targetOriginX = originX;
        targetOriginY = originY;

        // Snap to edges and re-render the scene ---
        // Snap immediately without animation.
        checkEdges(false); 
        render();
    }


    function handleMinimapMouseDown(e)
    {
        e.preventDefault();
        const { targetOriginX, targetOriginY } = calculateTargetOriginForMinimapEvent(e);

        jumpToOrigin(targetOriginX, targetOriginY);

        const onDrag = (moveEvent) => {
            const { targetOriginX, targetOriginY } = calculateTargetOriginForMinimapEvent(moveEvent);

            jumpToOrigin(targetOriginX, targetOriginY);
        };

        const onDragEnd = () => {
            window.removeEventListener('mousemove', onDrag);
            window.removeEventListener('mouseup', onDragEnd);
        };

        window.addEventListener('mousemove', onDrag);
        window.addEventListener('mouseup', onDragEnd);
    }


    function handleMinimapTouchStart(e)
    {
        console.log("whut handleMinimapTouchStart called")

        e.stopPropagation(); // Prevents the event from reaching the canvas listener.

        e.preventDefault(); // Prevent the page from scrolling

        // Use the first touch point to calculate the position
        const { targetOriginX, targetOriginY } = calculateTargetOriginForMinimapEvent(e.touches[0]);
        jumpToOrigin(targetOriginX, targetOriginY);

        const onTouchDrag = (moveEvent) => {
            // Use the first touch point from the 'move' event
            const { targetOriginX, targetOriginY } = calculateTargetOriginForMinimapEvent(moveEvent.touches[0]);
            jumpToOrigin(targetOriginX, targetOriginY);
        };

        const onTouchDragEnd = () => {
            // Stop listening when the finger is lifted
            minimapContainer.removeEventListener('touchmove', onTouchDrag);
            window.removeEventListener('touchend', onTouchDragEnd);
        };

        // Add the listeners for dragging and for ending the drag
        minimapContainer.addEventListener('touchmove', onTouchDrag);
        window.addEventListener('touchend', onTouchDragEnd);
    }

    // ------------------------------------------------------------
    // --- Main, this is where we start executing code for real ---
    // ------------------------------------------------------------

    // WebGL initialization

    // 1. Compile and link the shaders into a single program.
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    const program = createProgram(gl, vertexShader, fragmentShader);

    // 2. Look up the memory locations of our shader's attributes and uniforms.
    // We need these locations to send data to the GPU.
    const positionLocation = gl.getAttribLocation(program, "a_position");
    const texcoordLocation = gl.getAttribLocation(program, "a_texcoord");
    const texCoordScaleLocation = gl.getUniformLocation(program, "u_texCoordScale");
    const viewProjectionMatrixLocation = gl.getUniformLocation(program, "u_viewProjectionMatrix");
    const rotationMatrixLocation = gl.getUniformLocation(program, "u_rotationMatrix");

    // 3. Create WebGL Buffers. Buffers are chunks of memory on the GPU that hold our vertex data.
    const positionBuffer = gl.createBuffer();
    const texcoordBuffer = gl.createBuffer();

    // 4. Fill the texture coordinate buffer. The texture coordinates for a rectangular tile are always the same
    // (from top-left (0,0) to bottom-right (1,1)), so we can set this data once and never change it.    
    gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBuffer);

    // The coordinates correspond to the 6 vertices of the two triangles that form the rectangle.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);

    // Set up event listeners
    document.body.addEventListener('mouseleave', handleDocumentMouseLeave);

    window.addEventListener('keydown',   handleWindowKeyDown);
    window.addEventListener('resize',    debounce(handleWindowResize, 100));
    window.addEventListener('mousemove', handleCanvasMousePositionStatus);

    canvas.addEventListener('mousedown', handleCanvasMouseDown);
    canvas.addEventListener('dblclick',  handleCanvasDoubleClick);
    canvas.addEventListener('wheel',     handleCanvasWheel, { passive: false });

    // touch event listeners for mobile/tablet support
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd, { passive: false });

    panSlider.addEventListener('input',  handleSliderInput);
    panSlider.addEventListener('mousedown', (e) => e.stopPropagation());

    minimapContainer.addEventListener('mousedown', handleMinimapMouseDown);
    minimapContainer.addEventListener('touchstart', handleMinimapTouchStart, { passive: false });

    // Really start stuff up, load image and initialize us
    loadImageAndCreateTextureInfo(`${imageUrl}`, async () => {
        setInitialView();
        render();

        imageSizePixelsSpan.textContent = `${orgImgWidth}x${orgImgHeight}`;
        imageSizeBytesSpan.textContent = formatBytes(orgImgBytes);
        updatePanSlider();

        // The plugin system
        // -----------------
        const viewerApi = {
            getTransform: () => ({ scale, originX, originY }),
            getCanvas: () => canvas,
            requestRender: render
        };

        for(const plugin of plugins) {
            plugin.instance = createPluginInstance(plugin.name, viewerApi, plugin.options);
        }

        for(const plugin of plugins) {
            plugin.instance?.update();
        }

        if(canvas.width < 600) {
            document.body.classList.toggle('ui-hidden');
        }

        loader.classList.add('hidden');        
   });
}