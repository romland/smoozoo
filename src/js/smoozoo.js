window.smoozoo = (imageUrl, settings) => {
    let currentImageUrl = imageUrl;

    // Do HTML injection
    const targetElement = settings.canvas.parentElement; //document.body;
    let htmlFragment;

    htmlFragment = `
        <div id="smoozoo-status-display" class="smoozoo-display">
            <p class="narrow"><strong>🔍 </strong><span id="smoozoo-zoom-level">1.00</span>x</p>
            <p class="largedisplayonly wide"><strong>⌖ </strong><span id="smoozoo-mouse-coords">0, 0</span></p>
            <p class="wide"><strong>🗎 </strong><span id="smoozoo-image-size-pixels">0x0</span></p>
            <p class="narrow"><strong></strong><span id="smoozoo-image-size-bytes">0 B</span></p>
            <p><span id="smoozoo-image-file-name"></span></p>
        </div>
    `;
    targetElement.insertAdjacentHTML('beforeend', htmlFragment);

    htmlFragment = `
        <!-- disable slider by default (display none), minimap works so much better -->
        <div id="smoozoo-control-display" class="" style="display: none">
            <p class="pan-slider-container">
                <input type="range" id="smoozoo-pan-slider" min="0" max="100" value="0">
            </p>
        </div>
    `;
    targetElement.insertAdjacentHTML('beforeend', htmlFragment);

    if(settings.loadingAnimation !== false) {
        htmlFragment = `
            <div id="smoozoo-loader" class="loader-container hidden">
                <div class="loader-blobs">
                    <div class="blob" style="background-color:red;"></div>
                    <div class="blob" style="background-color:blue;"></div>
                    <div class="blob" style="background-color:green;"></div>
                </div>
                <div class="loader-text">
                    Loading
                </div>
            </div>
        `;
        targetElement.insertAdjacentHTML('beforeend', htmlFragment);
    }

    // DOM Element Selection & Initial Setup
    const canvas = settings.canvas;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    // We're requesting a 'webgl' context, which ~~is~~ was WebGL 1.
    // const gl = canvas.getContext('webgl');
    // Alright, need webgl2 for async pixels reading
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');

    if (!gl) {
        alert("WebGL is not supported in your browser.");
        throw new Error("WebGL not supported");
    }

    const loader = document.getElementById('smoozoo-loader');
    const zoomLevelSpan = document.getElementById('smoozoo-zoom-level');
    const mouseCoordsSpan = document.getElementById('smoozoo-mouse-coords');
    const imageSizePixelsSpan = document.getElementById('smoozoo-image-size-pixels');
    const imageSizeBytesSpan = document.getElementById('smoozoo-image-size-bytes');
    const imageFilenameSpan = document.getElementById('smoozoo-image-file-name');
    const panSlider = document.getElementById('smoozoo-pan-slider');

    // State Variables
    let scale = 1.0,
        originX = 0,
        originY = 0;
    let tiles = [],
        panning = false;
    let startX = 0,
        startY = 0;

    // To keep track of current position for deep linking
    let lastMouseRealX = 0,
        lastMouseRealY = 0;

    // Default settings if not provided
    settings.backgroundColor = settings.backgroundColor ?? "#0e0422";
    settings.pixelatedZoom = settings.pixelatedZoom ?? false;
    settings.allowDeepLinks = settings.allowDeepLinks ?? false;
    settings.dynamicTextureFiltering = settings.dynamicTextureFiltering ?? false;
    settings.dynamicFilteringThreshold = settings.dynamicFilteringThreshold ?? 2.0;    
    settings.maxScale = settings.maxScale ?? 20;
    settings.zoomStiffness = settings.zoomStiffness ?? 15;
    settings.elasticMoveDuration = settings.elasticMoveDuration ?? 200;
    settings.mouseInertiaFriction = settings.mouseInertiaFriction ?? 0.95;
    settings.touchInertiaFriction = settings.touchInertiaFriction ?? 0.98;
    settings.inertiaStopThreshold = settings.inertiaStopThreshold ?? 0.1;
    settings.animateDeepLinks = settings.animateDeepLinks ?? false;
    settings.statusShowFileName = settings.statusShowFileName ?? true;
    settings.statusShowFileSize = settings.statusShowFileSize ?? true;

    // Do some basic tweaks to HTML elements based on settings
    targetElement.style.backgroundColor = settings.backgroundColor;
    imageFilenameSpan.style.display = settings.statusShowFileName ? "block" : "none";
    imageSizeBytesSpan.style.display = settings.statusShowFileSize ? "block" : "none";


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
    let animateToAnimationId = null;
    let lastAnimationTime = 0;
    let currentMagFilter = null;

    // Get the maximum dimension (width or height) for a texture that the user's GPU can handle.
    // This is a hardware limitation. If an image is larger than this size, we can't load it as a single
    // texture. This is the entire reason for the "tiling" logic.
    // We will slice the large image into smaller pieces (tiles) that are each no larger than maxTextureSize.
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const webGLclearColor = hexToNormalizedRGB(settings.backgroundColor);

    // Plugins
    let plugins = settings.plugins || [];


    // ---------------------------------
    // --- General utility functions ---
    // ---------------------------------

    /**
     * Parses x, y, and scale from the URL query string.
     * @returns {object|null} An object with x, y, and scale, or null if not present.
     */
    function parseUrlParams()
    {
        const params = new URLSearchParams(window.location.search);
    
        const x = parseFloat(params.get('x'));
        const y = parseFloat(params.get('y'));
        const scale = parseFloat(params.get('scale'));
        const animate = params.get("animate") === "true";

        if (!isNaN(x) && !isNaN(y) && !isNaN(scale)) {
            return { x, y, scale, animate };
        }

        return null;
    }
    

    function hexToNormalizedRGB(hex)
    {
        let cleanHex = hex.startsWith('#') ? hex.slice(1) : hex;
        if (cleanHex.length === 3) {
            cleanHex = cleanHex.split('').map(char => char + char).join('');
        }
        const r = parseInt(cleanHex.substring(0, 2), 16);
        const g = parseInt(cleanHex.substring(2, 4), 16);
        const b = parseInt(cleanHex.substring(4, 6), 16);
        return {
            r: r / 255,
            g: g / 255,
            b: b / 255
        };
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


    function lerp(s, e, a)
    {
        return (1 - a) * s + a * e;
    }


    const easingFunctions = {
        linear: t => t,
        easeOutCubic: t => (--t) * t * t + 1,
        easeInOutCubic: t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
    };


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


    function createPluginInstance(ClassName, api, options)
    {
        const instance = new ClassName(api, options, targetElement);
        console.log("Plugin", instance.constructor.name, "instantiated.")
        return instance;
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
     */
    function nextPowerOf2(n)
    {
        if (n > 0 && (n & (n - 1)) === 0) {
            // Already a power of two
            return n;
        }

        let p = 1;
        while (p < n) {
            // Bitwise left shift (p = p * 2)
            p <<= 1;
        }

        return p;
    }


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
     * Updates the magnification filter on all loaded textures based on the current setting.
     * This allows toggling between "pixelated" and "blurry" when zoomed in.
     */
    function updateTextureFiltering()
    {
        const filter = settings.pixelatedZoom ? gl.NEAREST : gl.LINEAR;
        
        tiles.forEach(tile => {
            gl.bindTexture(gl.TEXTURE_2D, tile.texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        });

        // Unbind the texture to be safe
        gl.bindTexture(gl.TEXTURE_2D, null);
    }


    /**
     * Loads an image, pads each tile to be power-of-two, and creates WebGL textures with Mipmaps.
     */
    async function loadImageAndCreateTextureInfo(url, callback)
    {
        if(settings.loadingAnimation !== false) {
            loader.classList.remove('hidden');
        }

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

                const numXTiles = Math.ceil(img.width / maxTextureSize);
                const numYTiles = Math.ceil(img.height / maxTextureSize);

                for (let y = 0; y < numYTiles; y++) {
                    for (let x = 0; x < numXTiles; x++) {
                        const sx = x * maxTextureSize,
                              sy = y * maxTextureSize,
                              sw = Math.min(maxTextureSize, img.width - sx),
                              sh = Math.min(maxTextureSize, img.height - sy);

                        const tileCanvas = document.createElement('canvas');
                        tileCanvas.width = sw;
                        tileCanvas.height = sh;

                        const tileCtx = tileCanvas.getContext('2d');
                        tileCtx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

                        const potCanvas = document.createElement('canvas');
                        potCanvas.width = nextPowerOf2(sw);
                        potCanvas.height = nextPowerOf2(sh);
                        const potCtx = potCanvas.getContext('2d');
                        potCtx.drawImage(tileCanvas, 0, 0);

                        const texCoordScaleX = sw / potCanvas.width;
                        const texCoordScaleY = sh / potCanvas.height;

                        const texture = gl.createTexture();
                        gl.bindTexture(gl.TEXTURE_2D, texture);
                        
                        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, potCanvas);
                        gl.generateMipmap(gl.TEXTURE_2D);

                        // We set MIN_FILTER for mipmapping when zoomed out.
                        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
                        
                        // We will set MAG_FILTER later using our new function.
                        // gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); // This line is now handled by updateTextureFiltering
                        
                        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

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

                // Apply the initial texture filtering setting once all tiles are created.
                // NOTE: Not any more, we have dynamic filtering
                // updateTextureFiltering();

                imageFilenameSpan.textContent = url.split('/').pop();
                URL.revokeObjectURL(objectURL);
                callback();
            };
        } catch (error) {
            console.error("Failed to load image:", error);
            alert(`Failed to load image "${url}", most likely a CORS issue. See console.`);
            throw error;
        }
    }


    /**
     * Renders the entire scene to an off-screen Framebuffer Object (FBO)
     * at a specified resolution and reads the raw pixel data back from the GPU.
     * This is the core of the high-speed thumbnail generation.
     * @param {number} targetWidth The desired width of the output image.
     * @param {number} targetHeight The desired height of the output image.
     * @returns {Uint8Array | null} A buffer with the RGBA pixel data, or null on failure.
     */
    function renderToPixels(targetWidth, targetHeight)
    {
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);

        const fboTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, fboTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, targetWidth, targetHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTexture, 0);

        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
            console.error("Render-to-texture framebuffer is not complete.");
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.deleteTexture(fboTexture);
            gl.deleteFramebuffer(fbo);
            return null;
        }

        const originalViewport = gl.getParameter(gl.VIEWPORT);
        gl.viewport(0, 0, targetWidth, targetHeight);

        // gl.clearColor(0.055, 0.016, 0.133, 1.0); // Background color
        gl.clearColor(webGLclearColor.r, webGLclearColor.g, webGLclearColor.b, 1.0);

        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(program);

        // Setup Position Attribute
        gl.enableVertexAttribArray(positionLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

        // Setup Texcoord Attribute
        gl.enableVertexAttribArray(texcoordLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBuffer);
        gl.vertexAttribPointer(texcoordLocation, 2, gl.FLOAT, false, 0, 0);

        // Create a special view-projection matrix that perfectly fits the entire
        // un-rotated image into the target texture's viewport.
        const { width: imgW, height: imgH } = getCurrentImageSize();
        const fitMatrix = [2 / imgW, 0, 0, 0, -2 / imgH, 0, -1, 1, 1];
        const identityMatrix = [1, 0, 0, 0, 1, 0, 0, 0, 1];

        gl.uniformMatrix3fv(viewProjectionMatrixLocation, false, fitMatrix);
        gl.uniformMatrix3fv(rotationMatrixLocation, false, identityMatrix);

        // Draw all tiles to the FBO
        tiles.forEach(tile => {
            gl.bindTexture(gl.TEXTURE_2D, tile.texture);
            gl.uniform2f(texCoordScaleLocation, tile.texCoordScaleX, tile.texCoordScaleY);
            
            // The setRectangle function internally binds the positionBuffer again, which is fine.
            setRectangle(gl, tile.x, tile.y, tile.width, tile.height);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        });

        // Read the pixels back from the FBO
        const pixelData = new Uint8Array(targetWidth * targetHeight * 4);
        gl.readPixels(0, 0, targetWidth, targetHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixelData);

        // Cleanup and restore the original rendering context
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(originalViewport[0], originalViewport[1], originalViewport[2], originalViewport[3]);
        gl.deleteTexture(fboTexture);
        gl.deleteFramebuffer(fbo);

        return pixelData;
    }


    /**
     * Asynchronously renders the entire scene to an off-screen
     * buffer and resolves a Promise with the pixel data when ready. This uses a
     * Pixel Buffer Object (PBO) and a Sync object to prevent blocking the main thread.
     * @param {number} targetWidth The desired width of the output image.
     * @param {number} targetHeight The desired height of the output image.
     * @returns {Promise<Uint8Array | null>} A Promise that resolves with the pixel data.
     */
    function renderToPixelsAsync(targetWidth, targetHeight)
    {
        return new Promise((resolve) => {
            // This is a new feature; check for WebGL2 or the necessary extensions.
            if (!gl.fenceSync) {
                console.warn("Asynchronous pixel reading not supported. Falling back to synchronous method.");
                resolve(renderToPixels(targetWidth, targetHeight));
                return;
            }

            const fbo = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);

            const fboTexture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, fboTexture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, targetWidth, targetHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTexture, 0);

            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
                console.error("Render-to-texture framebuffer is not complete.");
                resolve(null);
                return;
            }

            // Start of PBO logic
            const pbo = gl.createBuffer();
            const bufferSize = targetWidth * targetHeight * 4;
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
            gl.bufferData(gl.PIXEL_PACK_BUFFER, bufferSize, gl.STREAM_READ);

            // Render the scene
            const originalViewport = gl.getParameter(gl.VIEWPORT);
            gl.viewport(0, 0, targetWidth, targetHeight);
            gl.useProgram(program);

            gl.enableVertexAttribArray(positionLocation);
            gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
            gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
            gl.enableVertexAttribArray(texcoordLocation);
            gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBuffer);
            gl.vertexAttribPointer(texcoordLocation, 2, gl.FLOAT, false, 0, 0);
            
            const { width: imgW, height: imgH } = getCurrentImageSize();
            const fitMatrix = [2 / imgW, 0, 0, 0, -2 / imgH, 0, -1, 1, 1];
            const identityMatrix = [1, 0, 0, 0, 1, 0, 0, 0, 1];
            gl.uniformMatrix3fv(viewProjectionMatrixLocation, false, fitMatrix);
            gl.uniformMatrix3fv(rotationMatrixLocation, false, identityMatrix);

            // Calculate the ideal mip level to use. This selects a mipmap that
            // is closest in size to our target thumbnail, saving huge amounts of texture fetching.
            const scaleRatio = imgW / targetWidth;
            const mipLevel = Math.max(0, Math.floor(Math.log2(scaleRatio)));
            
            tiles.forEach(tile => {
                gl.bindTexture(gl.TEXTURE_2D, tile.texture);

                // Tell WebGL to use our calculated mip level as the base texture
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, mipLevel);
                
                gl.uniform2f(texCoordScaleLocation, tile.texCoordScaleX, tile.texCoordScaleY);
                setRectangle(gl, tile.x, tile.y, tile.width, tile.height);
                gl.drawArrays(gl.TRIANGLES, 0, 6);

                // IMPORTANT: Reset the base level to 0 so the main renderer
                // uses the highest quality texture.
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, 0);
            });

            // Read pixels into the PBO. This call returns immediately.
            gl.readPixels(0, 0, targetWidth, targetHeight, gl.RGBA, gl.UNSIGNED_BYTE, 0);
            
            // Unbind the PBO from the PIXEL_PACK target
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
            
            // Create a sync object to check for completion
            const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);

            // Restore viewport and framebuffer for the main application
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(originalViewport[0], originalViewport[1], originalViewport[2], originalViewport[3]);
            
            // Poll for completion without blocking
            const checkCompletion = () => {
                const status = gl.clientWaitSync(sync, 0, 0);
                if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) {
                    // Data transfer is complete
                    const pixels = new Uint8Array(bufferSize);
                    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
                    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, pixels);

                    // Cleanup
                    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
                    gl.deleteSync(sync);
                    gl.deleteBuffer(pbo);
                    gl.deleteTexture(fboTexture);
                    gl.deleteFramebuffer(fbo);

                    resolve(pixels);
                } else {
                    // Not ready yet, check again on the next frame
                    requestAnimationFrame(checkCompletion);
                }
            };

            requestAnimationFrame(checkCompletion);
        });
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

        // DYNAMIC TEXTURE FILTERING
        // Determine which magnification filter should be used based on settings.
        let targetMagFilter;

        if (settings.dynamicTextureFiltering) {
            // Dynamic mode: Choose filter based on the current zoom scale.
            targetMagFilter = scale >= settings.dynamicFilteringThreshold ? gl.NEAREST : gl.LINEAR;
        } else {
            // Static mode: Fall back to the manual pixelatedZoom setting.
            targetMagFilter = settings.pixelatedZoom ? gl.NEAREST : gl.LINEAR;
        }

        // If the required filter is different from the one currently applied, update all textures.
        // This check prevents expensive WebGL calls on every single frame.
        if (targetMagFilter !== currentMagFilter) {
            currentMagFilter = targetMagFilter;
            tiles.forEach(tile => {
                gl.bindTexture(gl.TEXTURE_2D, tile.texture);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, currentMagFilter);
            });

            // Unbind texture to be safe
            gl.bindTexture(gl.TEXTURE_2D, null);
        }


        // gl.clearColor(0.055, 0.016, 0.133, 1.0); // Background color
        gl.clearColor(webGLclearColor.r, webGLclearColor.g, webGLclearColor.b, 1.0);
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

        // View Frustum Culling
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
            if (tile.x < viewX + viewWidth && tile.x + tile.width > viewX &&
                tile.y < viewY + viewHeight && tile.y + tile.height > viewY)
            {
                gl.bindTexture(gl.TEXTURE_2D, tile.texture);
                
                // Set the texture coordinate scale for this specific tile
                gl.uniform2f(texCoordScaleLocation, tile.texCoordScaleX, tile.texCoordScaleY);

                setRectangle(gl, tile.x, tile.y, tile.width, tile.height);
                gl.drawArrays(gl.TRIANGLES, 0, 6);
            }
        });

        zoomLevelSpan.textContent = scale.toFixed(2);
        updatePanSlider();

        if(plugins.length) {
            for(const plugin of plugins) {
                plugin.instance?.update && plugin.instance?.update();
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

        if (animateToAnimationId) {
            cancelAnimationFrame(animateToAnimationId);
            animateToAnimationId = null;
        }
        
        lastAnimationTime = 0;

        isZooming = false;
    }


    /**
     * Calculates the valid, clamped origin coordinates for a given target state.
     * This prevents the animation from overshooting the image boundaries.
     * @private
     * @param {number} targetOriginX - The desired, but potentially invalid, x-origin.
     * @param {number} targetOriginY - The desired, but potentially invalid, y-origin.
     * @param {number} targetScale - The scale at which to check the boundaries.
     * @returns {{x: number, y: number}} - The clamped, valid origin coordinates.
     */
    function getClampedOrigin(targetOriginX, targetOriginY, targetScale)
    {
        const { width: imageWidth, height: imageHeight } = getCurrentImageSize();
        const viewWidth = canvas.width / targetScale;
        const viewHeight = canvas.height / targetScale;

        let finalX = targetOriginX;
        let finalY = targetOriginY;

        // Clamp the X coordinate
        if (imageWidth < viewWidth) {
            finalX = (viewWidth - imageWidth) / 2; // Center if image is smaller than view
        } else {
            const minOriginX = viewWidth - imageWidth;
            finalX = Math.max(minOriginX, Math.min(0, finalX));
        }

        // Clamp the Y coordinate
        if (imageHeight < viewHeight) {
            finalY = (viewHeight - imageHeight) / 2; // Center if image is smaller than view
        } else {
            const minOriginY = viewHeight - imageHeight;
            finalY = Math.max(minOriginY, Math.min(0, finalY));
        }

        return { x: finalX, y: finalY };
    }


    /**
     * Smoothly pans and scales the view to a target point over a given duration.
     * @public
     * @param {object} options - The animation options.
     * @param {number} options.x - The target x-coordinate in the image's pixel space to center on.
     * @param {number} options.y - The target y-coordinate in the image's pixel space to center on.
     * @param {number} options.scale - The target scale level.
     * @param {number} [options.duration=1000] - The duration of the animation in milliseconds.
     * @param {string} [options.easing='easeInOutCubic'] - The name of the easing function to use.
     */
    function animateTo({
        x,
        y,
        scale: newScale,
        duration = 1000,
        easing = 'easeInOutCubic'
    }) {
        cancelAllAnimations();

        const finalScale = Math.max(minScale, Math.min(newScale, settings.maxScale));
        const easingFunc = easingFunctions[easing] || easingFunctions.easeInOutCubic;

        // Calculate the ideal origin to center the view on the target coordinates
        const idealOriginX = (canvas.width / (2 * finalScale)) - x;
        const idealOriginY = (canvas.height / (2 * finalScale)) - y;

        // Get the valid, clamped final destination *before* starting the animation
        const finalOrigin = getClampedOrigin(idealOriginX, idealOriginY, finalScale);

        const animationParams = {
            startTime: performance.now(),
            duration: duration,
            easingFunc: easingFunc,
            startScale: scale,
            startOriginX: originX,
            startOriginY: originY,
            targetScale: finalScale,
            targetOriginX: finalOrigin.x,
            targetOriginY: finalOrigin.y,
        };

        animateToAnimationId = requestAnimationFrame(() => animateToLoop(animationParams));
    }


    function animateToLoop({
        startTime,
        duration,
        easingFunc,
        startScale,
        startOriginX,
        startOriginY,
        targetScale,
        targetOriginX,
        targetOriginY
    }) {
        const currentTime = performance.now();
        const elapsedTime = currentTime - startTime;
        let progress = Math.min(elapsedTime / duration, 1);
        const easedProgress = easingFunc(progress);

        scale = lerp(startScale, targetScale, easedProgress);
        originX = lerp(startOriginX, targetOriginX, easedProgress);
        originY = lerp(startOriginY, targetOriginY, easedProgress);

        render();

        if (progress < 1) {
            animateToAnimationId = requestAnimationFrame(() => animateToLoop(
                {
                    startTime,
                    duration,
                    easingFunc,
                    startScale,
                    startOriginX,
                    startOriginY,
                    targetScale,
                    targetOriginX,
                    targetOriginY
                }
            ));
        } else {
            // Animation finished, set final state precisely
            scale = targetScale;
            originX = targetOriginX;
            originY = targetOriginY;
            animateToAnimationId = null;
            render();
        }
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
     * Checks if the view is outside the image boundaries and corrects it.
     */
    function checkEdges(elasticSnap = true)
    {
        // Get the correct, clamped origin for the *current* view state.
        const clampedOrigin = getClampedOrigin(originX, originY, scale);

        // If the current origin is not in a valid position...
        if (clampedOrigin.x !== originX || clampedOrigin.y !== originY) {
            if (elasticSnap) {
                // ...animate to the correct position.
                elasticMove(clampedOrigin.x, clampedOrigin.y);
            } else {
                // ...or snap to it directly.
                originX = clampedOrigin.x;
                originY = clampedOrigin.y;
                render();
            }
        }
    }



    /**
     * Smoothly interpolates the scale and origin to their target values
     * using a time-based, frame-rate independent method to prevent jitter.
     */
    function smoothZoomLoop(currentTime)
    {
        if (!lastAnimationTime) {
            // Initialize timer on the first frame of the animation.
            lastAnimationTime = currentTime;
        }

        // Calculate time elapsed in seconds since the last frame.
        const deltaTime = (currentTime - lastAnimationTime) / 1000;
        lastAnimationTime = currentTime;

        isZooming = true;

        // A higher stiffness value results in a faster, more responsive zoom.
        const stiffness = settings.zoomStiffness;
        const frameSmoothing = 1 - Math.exp(-stiffness * deltaTime);

        scale = lerp(scale, targetScale, frameSmoothing);
        originX = lerp(originX, targetOriginX, frameSmoothing);
        originY = lerp(originY, targetOriginY, frameSmoothing);

        render();

        const scaleDiff = Math.abs(scale - targetScale);
        const originXDiff = Math.abs(originX - targetOriginX);
        const originYDiff = Math.abs(originY - targetOriginY);

        // Stop the animation when we are very close to the target.
        if (scaleDiff < 0.001 && originXDiff < 0.001 && originYDiff < 0.001) {
            scale = targetScale;
            originX = targetOriginX;
            originY = targetOriginY;

            isZooming = false;
            smoothZoomAnimationId = null;
            lastAnimationTime = 0; // Reset for the next animation sequence.
            
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

        const stopThreshold = settings.inertiaStopThreshold;

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


    function jumpToOrigin(targetOriginX, targetOriginY)
    {
        cancelAllAnimations();

        const clampedOrigin = getClampedOrigin(targetOriginX, targetOriginY, scale);

        originX = clampedOrigin.x;
        originY = clampedOrigin.y;
        
        targetOriginX = originX;
        targetOriginY = originY;

        render();
    }


    function setInitialView()
    {
        if (!orgImgWidth) {
            return;
        }

        const { width: imageWidth, height: imageHeight } = getCurrentImageSize();

        let urlParams = null;
        let didDeepLink = false;

        // Check if deep linking is allowed and if valid parameters are in the URL.
        if (settings.allowDeepLinks) {
            urlParams = parseUrlParams();
            if (urlParams) {
                didDeepLink = true;
            }
        }

        if (didDeepLink) {
            // Handle Deep Link
            if(urlParams.animate) {
                scale = 0.1;
                originX = 0
                originY = 0

                animateTo({ x: urlParams.x, y: urlParams.y, scale: urlParams.scale, duration: 2500, easing: "easeInOutCubic" });
            } else {
                scale = targetScale = urlParams.scale;
                minScale = Math.min(scale, 0.1);

                const idealX = (canvas.width / (2 * scale)) - urlParams.x;
                const idealY = (canvas.height / (2 * scale)) - urlParams.y;
                const clamped = getClampedOrigin(idealX, idealY, scale);

                originX = targetOriginX = clamped.x;
                originY = targetOriginY = clamped.y;
            }

        } else {
            // Handle Standard Initial View
            const scaleToFitWidth = canvas.width / imageWidth;
            const scaleToFitHeight = canvas.height / imageHeight;
            const fitScale = Math.min(scaleToFitWidth, scaleToFitHeight);

            scale = targetScale = Math.min(1.0, fitScale);
            minScale = Math.min(scale, 0.1);

            if (settings.initialScale) {
                scale = targetScale = settings.initialScale;
            }

            let targetX, targetY;

            // Use initial position from settings if provided
            if (settings.initialPosition && typeof settings.initialPosition.x === 'number' && typeof settings.initialPosition.y === 'number') {
                targetX = settings.initialPosition.x;
                targetY = settings.initialPosition.y;

                // If coordinates are percentages, convert them to pixels
                if (targetX >= 0 && targetX <= 1 && targetY >= 0 && targetY <= 1) {
                    targetX = imageWidth * targetX;
                    targetY = imageHeight * targetY;
                }
            } else {
                // Default to the center of the image if no position is given
                targetX = imageWidth / 2;
                targetY = imageHeight / 2;
            }

            const idealX = (canvas.width / (2 * scale)) - targetX;
            const idealY = (canvas.height / (2 * scale)) - targetY;
            const clamped = getClampedOrigin(idealX, idealY, scale);
            originX = targetOriginX = clamped.x;
            originY = targetOriginY = clamped.y;
        }

        render();
    }


    /**
     * Cleans up resources associated with the current image. It can optionally
     * preserve the view state (scale, origin, rotation) for the next image load.
     * @private
     * @param {object} [options]
     * @param {boolean} [options.preserveState=false] - If true, view state is not reset.
     */
    function _cleanup({ preserveState = false } = {})
    {
        // Always cancel any running animations
        cancelAllAnimations();

        // Always delete all WebGL textures from the GPU
        tiles.forEach(tile => {
            gl.deleteTexture(tile.texture);
        });

        // Always clear the tile array and image-specific data
        tiles = [];
        orgImgWidth = 0;
        orgImgHeight = 0;
        orgImgBytes = 0;

        // Force the render loop to apply the correct texture filter to the newly created tiles.
        currentMagFilter = null;

        // If the current image was from a Blob/File, revoke its URL to free memory
        if (currentImageUrl && currentImageUrl.startsWith('blob:')) {
            URL.revokeObjectURL(currentImageUrl);
        }
        
        // Conditionally reset the view transform state.
        // If preserving state, we simply keep the existing values.
        if (!preserveState) {
            scale = 1.0;
            originX = 0;
            originY = 0;
            targetScale = 1.0;
            targetOriginX = 0;
            targetOriginY = 0;
            rotation = 0;
        }
    }


    /**
     * This is a public API method for loading a new image.
     * It cleans up the old image and initializes the new one, with an option
     * to preserve the current pan, zoom, and rotation.
     * @param {string} newUrl The URL of the new image to load.
     * @param {object} [options]
     * @param {boolean} [options.preserveState=false] - If true, the view state is retained across loads.
     */
    function loadImage(newUrl, { preserveState = false } = {})
    {
        console.log(`Loading image: ${newUrl}, preserveState: ${preserveState}`);
        
        // Cleanup resources, passing the preserveState option.
        _cleanup({ preserveState });
        currentImageUrl = newUrl; // Update the tracked URL
        
        // The core loading logic
        loadImageAndCreateTextureInfo(newUrl, () => {
            // If we preserved the state, we must not call setInitialView(),
            // as that would reset the pan and zoom. Instead, we just ensure the
            // current view is valid for the new image's dimensions.
            if (preserveState) {
                // Sync animation targets with the preserved state
                targetScale = scale;
                targetOriginX = originX;
                targetOriginY = originY;
                // Snap to the new image's edges if the old view is now out of bounds
                checkEdges(false); 
            } else {
                // Default behavior: reset the view to fit the new image.
                setInitialView();
            }
            
            imageSizePixelsSpan.textContent = `${orgImgWidth}x${orgImgHeight}`;
            imageSizeBytesSpan.textContent = formatBytes(orgImgBytes);
            updatePanSlider();

            // Notify all plugins that a new image has been loaded
            for (const plugin of plugins) {
                if (typeof plugin.instance?.onImageLoaded === 'function') {
                    plugin.instance.onImageLoaded(newUrl);
                }
            }

            for(const plugin of plugins) {
                plugin.instance?.update && plugin.instance?.update();
            }

            render();

            if(settings.loadingAnimation !== false) {
                loader.classList.add('hidden');
            }
        });
    }


    // ----------------------
    // --- Event Handlers ---
    // ----------------------

    // ------------------------------------
    // --- Mouse Event Wrappers -----------
    // ------------------------------------
    
    function handleCanvasMouseDown(e)
    {
        canvas.classList.add('panning');

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


    function handleCanvasMouseMove(e)
    {
        if (!panning) {
            return;
        }

        const deltaX = e.clientX - lastMouseX;
        const deltaY = e.clientY - lastMouseY;

        const { width: imageWidth, height: imageHeight } = getCurrentImageSize();
        const viewWidth = canvas.width / scale;
        const viewHeight = canvas.height / scale;

        let newOriginX = (e.clientX / scale) - startX;
        let newOriginY = (e.clientY / scale) - startY;

        // If image is narrower than the canvas, lock it to the center
        // horizontally and prevent horizontal inertia.
        if (imageWidth < viewWidth) {
            newOriginX = (viewWidth - imageWidth) / 2;
            panVelocityX = 0;
        } else {
            panVelocityX = deltaX;
        }

        // If image is shorter than the canvas, lock it to the center
        // vertically and prevent vertical inertia.
        if (imageHeight < viewHeight) {
            newOriginY = (viewHeight - imageHeight) / 2;
            panVelocityY = 0;
        } else {
            panVelocityY = deltaY;
        }

        originX = newOriginX;
        originY = newOriginY;

        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        render();
    }


    function handleCanvasMouseUp(e)
    {
        canvas.classList.remove('panning');

        if (!panning) {
            return;
        }

        window.removeEventListener('mousemove', handleCanvasMouseMove);
        window.removeEventListener('mouseup', handleCanvasMouseUp);
        
        if (panVelocityX !== 0 || panVelocityY !== 0) {
            cancelAllAnimations();

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
        for(const plugin of plugins) {
            if(plugin.instance?.mayTouchStartOnCanvas
               && !plugin.instance?.mayTouchStartOnCanvas(e)) {
                return;
            }
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

            const { width: imageWidth, height: imageHeight } = getCurrentImageSize();
            const viewWidth = canvas.width / scale;
            const viewHeight = canvas.height / scale;

            let newOriginX = (touch.clientX / scale) - startX;
            let newOriginY = (touch.clientY / scale) - startY;

            // If image is narrower than the canvas, lock it to the center
            // horizontally and prevent horizontal inertia.
            if (imageWidth < viewWidth) {
                newOriginX = (viewWidth - imageWidth) / 2;
                panVelocityX = 0;
            } else {
                panVelocityX = deltaX;
            }

            // If image is shorter than the canvas, lock it to the center
            // vertically and prevent vertical inertia.
            if (imageHeight < viewHeight) {
                newOriginY = (viewHeight - imageHeight) / 2;
                panVelocityY = 0;
            } else {
                panVelocityY = deltaY;
            }

            originX = newOriginX;
            originY = newOriginY;

            lastMouseX = touch.clientX;
            lastMouseY = touch.clientY;
            render();

        } else if (e.touches.length === 2 && isTouching) {
            const t1 = e.touches[0], t2 = e.touches[1];
            const currentPinchDistance = Math.sqrt(Math.pow(t1.clientX - t2.clientX, 2) + Math.pow(t1.clientY - t2.clientY, 2));
            if (initialPinchDistance > 0) {
                scale = Math.max(minScale, Math.min(initialScale * (currentPinchDistance / initialPinchDistance), settings.maxScale));
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


    /**
     * Keeping focus on the pixel under the pointer would always be a tough
     * thing to pull off with the acceleration/momentum/snapback. But I think
     * this does the best of both worlds -- it's fast and _somewhat_ keeps
     * focus in place.
     * 
     * Check if an animation is running. If NOT, it's the start of a new
     * zoom sequence, so we must sync the targets with the current state to
     * account for any panning. If an animation IS running, we don't sync,
     * which preserves the zoom's momentum and makes it feel fast.
     * 
     * @param {*} e 
     */
    function handleCanvasWheel(e)
    {
        e.preventDefault();

        if (!isZooming) {
            cancelAllAnimations();
            targetScale = scale;
            targetOriginX = originX;
            targetOriginY = originY;
        }

        const zoomFactor = 1.1;
        const scaleAmount = e.deltaY > 0 ? 1 / zoomFactor : zoomFactor;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;

        // Calculate world coordinates based on the TARGET values.
        const worldMouseX = (lastMouseX / targetScale) - targetOriginX;
        const worldMouseY = (lastMouseY / targetScale) - targetOriginY;

        // Calculate the new target scale and clamp it.
        const newTargetScale = targetScale * scaleAmount;
        targetScale = Math.max(minScale, Math.min(newTargetScale, settings.maxScale));

        const rawTargetOriginX = (lastMouseX / targetScale) - worldMouseX;
        const rawTargetOriginY = (lastMouseY / targetScale) - worldMouseY;

        const finalTarget = getClampedOrigin(rawTargetOriginX, rawTargetOriginY, targetScale);
        targetOriginX = finalTarget.x;
        targetOriginY = finalTarget.y;

        // Start the animation loop if it's not already running.
        if (!isZooming) {
            smoothZoomAnimationId = requestAnimationFrame(smoothZoomLoop);
        }
    }


    function handleCanvasDoubleClick(e)
    {
        e.preventDefault();
        cancelAllAnimations();

        let finalScale = (Math.abs(scale - 1.0) < 0.01) ? 0.25 : 1.0;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        targetScale = finalScale;

        const worldMouseX = (lastMouseX / scale) - originX;
        const worldMouseY = (lastMouseY / scale) - originY;
        
        const rawTargetOriginX = (lastMouseX / targetScale) - worldMouseX;
        const rawTargetOriginY = (lastMouseY / targetScale) - worldMouseY;

        // Use the helper to get the final, valid target origin
        const finalTarget = getClampedOrigin(rawTargetOriginX, rawTargetOriginY, targetScale);
        targetOriginX = finalTarget.x;
        targetOriginY = finalTarget.y;

        if (!isZooming) {
            smoothZoomAnimationId = requestAnimationFrame(smoothZoomLoop);
        }
    }



    async function handleWindowKeyDown(e)
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

            case 'c':
                if (e.ctrlKey) {
                    break;
                }

                e.preventDefault();

                const path = `${window.location.protocol}//${window.location.host}${window.location.pathname}`;
                const search = `?x=${lastMouseRealX}&y=${lastMouseRealY}&scale=${scale.toFixed(6)}${settings.animateDeepLinks ? "&animate=true" : ""}`;

                if(true) {
                    // Throw in clipboard
                    const type = "text/plain";
                    const clipboardItemData = {
                        [type]: `${path}${search}`,
                    };

                    const clipboardItem = new ClipboardItem(clipboardItemData);
                    await navigator.clipboard.write([clipboardItem]);
                }

                console.log("Generated deep link:", `${path}${search}`)

                if(history.pushState) {
                    window.history.pushState({ path : `${path}${search}` }, '', `${path}${search}`);
                }
                break;

            case 'm':
                document.body.classList.toggle('ui-hidden');
                break;

            case 'p':
                settings.pixelatedZoom = !settings.pixelatedZoom;
                updateTextureFiltering();
                render();
                break;

            case 'r':
            case 'R':
                if (e.ctrlKey) {
                    break;
                }

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

        lastMouseRealX = x;
        lastMouseRealY = y;

        mouseCoordsSpan.textContent = `${x},${y}`;
        
        if(plugins.length) {
            for(const plugin of plugins) {
                plugin.instance?.onMouseMove && plugin.instance?.onMouseMove(e);
            }
        }
    }


    function handleWindowResize()
    {
        const oldWidth = canvas.width;
        const oldHeight = canvas.height;
        
        const centerWorldX = (oldWidth / (2 * scale)) - originX;
        const centerWorldY = (oldHeight / (2 * scale)) - originY;

        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        gl.viewport(0, 0, canvas.width, canvas.height);

        const idealOriginX = (canvas.width / (2 * scale)) - centerWorldX;
        const idealOriginY = (canvas.height / (2 * scale)) - centerWorldY;

        const clamped = getClampedOrigin(idealOriginX, idealOriginY, scale);
        originX = targetOriginX = clamped.x;
        originY = targetOriginY = clamped.y;

        render();
    }


    // ------------------------------------------------------------
    // --- Main, this is where we start executing code for real ---
    // ------------------------------------------------------------

    // WebGL initialization

    // Compile and link the shaders into a single program.
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    const program = createProgram(gl, vertexShader, fragmentShader);

    // Look up the memory locations of our shader's attributes and uniforms.
    // We need these locations to send data to the GPU.
    const positionLocation = gl.getAttribLocation(program, "a_position");
    const texcoordLocation = gl.getAttribLocation(program, "a_texcoord");
    const texCoordScaleLocation = gl.getUniformLocation(program, "u_texCoordScale");
    const viewProjectionMatrixLocation = gl.getUniformLocation(program, "u_viewProjectionMatrix");
    const rotationMatrixLocation = gl.getUniformLocation(program, "u_rotationMatrix");

    // Create WebGL Buffers. Buffers are chunks of memory on the GPU that hold our vertex data.
    const positionBuffer = gl.createBuffer();
    const texcoordBuffer = gl.createBuffer();

    // Fill the texture coordinate buffer. The texture coordinates for a rectangular tile are always the same
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

    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd, { passive: false });

    panSlider.addEventListener('input',  handleSliderInput);
    panSlider.addEventListener('mousedown', (e) => e.stopPropagation());

    // ----------------------
    // --- The plugin API ---
    // ----------------------
    const viewerApi = {
        getTransform: () => ({ scale, originX, originY }),
        getCanvas: () => canvas,
        getTiles: () => tiles,
        getImageSize: getCurrentImageSize,
        requestRender: render,
        jumpToOrigin: jumpToOrigin,
        cancelAllAnimations: cancelAllAnimations,
        renderToPixels: renderToPixels,
        renderToPixelsAsync: renderToPixelsAsync,
        loadImage: loadImage,
        animateTo: animateTo,
        currentImageUrl: () => currentImageUrl,
        currentImageFilename: currentImageUrl.split('/').pop()
    };

    loadImage(imageUrl);

    for(const plugin of plugins) {
        plugin.instance = createPluginInstance(plugin.name, viewerApi, plugin.options);
    }

    if(canvas.width < 600) {
        document.body.classList.toggle('ui-hidden');
    }

   return viewerApi;
}