/**
 * Fetches all available information for a single image ID from the server.
 * server
 * @param {string} imageId The unique ID of the image.
 * @returns {Promise<object>} A promise that resolves with the image details object.
 */
export async function fetchImageInfo(apiOrigin, imageId)
{
    if (!imageId) {
        throw new Error('Image ID must be provided.');
    }

    try {
        const response = await fetch(`${apiOrigin}/api/info/${imageId}`);

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Failed to fetch image info for ${imageId}. Status: ${response.status}. Reason: ${errorData.error}`);
        }

        const data = await response.json();
        // console.log(`✅ Successfully fetched info for ${imageId}:`, data);
        return data;

    } catch (error) {
        console.error('🚨 Error in fetchImageInfo:', error);
        throw error; // Re-throw the error so the calling code can handle it
    }
}


/**
 * Fetches all available information for an array of image IDs in a single batch request.
 * server
 * @param {string[]} imageIds An array of image IDs.
 * @returns {Promise<object[]>} A promise that resolves with an array of image detail objects.
 */
export async function fetchMultipleImageInfo(apiOrigin, imageIds)
{
    if (!Array.isArray(imageIds) || imageIds.length === 0) {
        throw new Error('An array of image IDs must be provided.');
    }

    try {
        const response = await fetch(`${apiOrigin}/api/info/batch`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ids: imageIds }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Failed to fetch batch image info. Status: ${response.status}. Reason: ${errorData.error}`);
        }

        const data = await response.json();
        // console.log(`✅ Successfully fetched batch info for ${data.length} images:`, data);
        return data;

    } catch (error) {
        console.error('🚨 Error in fetchMultipleImageInfo:', error);
        throw error; // Re-throw the error so the calling code can handle it
    }
}


// Simple wrapper for localStorage to act as a key-value store
export class LocalStorageDB {
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

export class ThumbnailCache {
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

/**
 * Smoozoo Advanced Quadtree
 *
 * This quadtree implementation correctly handles objects that span boundaries by storing them
 * in parent nodes, which prevents rendering artifacts and disappearing objects at high zoom levels.
 * It also includes screen-size culling to skip rendering nodes that are too small to be visible,
 * ensuring optimal performance for massive collections.
 */
export class Quadtree {
    /**
     * @param {object} boundary - The { x, y, width, height } of the node.
     * @param {number} [capacity=4] - The maximum number of items a node can hold before it subdivides.
     * @param {number} [level=0] - The depth of the node in the tree.
     */
    constructor(boundary, capacity = 4, level = 0) {
        if (!boundary) {
            throw new Error("Boundary is a required argument for Quadtree constructor.");
        }
        this.boundary = boundary;
        this.capacity = capacity;
        this.level = level;

        // All items in this node. In a parent node, these are items that span child boundaries.
        // In a leaf node, these are all items within that node.
        this.items = [];
        this.children = [];
        this.divided = false;
    }

    /**
     * Creates four child nodes and moves items from this node down to them.
     */
    subdivide() {
        const { x, y, width, height } = this.boundary;
        const w2 = width / 2;
        const h2 = height / 2;
        const nextLevel = this.level + 1;

        this.children[0] = new Quadtree({ x: x + w2, y: y, width: w2, height: h2 }, this.capacity, nextLevel); // Northeast
        this.children[1] = new Quadtree({ x: x, y: y, width: w2, height: h2 }, this.capacity, nextLevel); // Northwest
        this.children[2] = new Quadtree({ x: x, y: y + h2, width: w2, height: h2 }, this.capacity, nextLevel); // Southwest
        this.children[3] = new Quadtree({ x: x + w2, y: y + h2, width: w2, height: h2 }, this.capacity, nextLevel); // Southeast

        this.divided = true;

        // Re-distribute the items from this node (which is now a parent)
        const currentItems = this.items;
        this.items = [];
        for (const item of currentItems) {
            this.insert(item); // Re-insert items, which will now filter into children or stay here
        }
    }

    /**
     * Gets the index of the child node that an item completely fits within.
     * @param {object} item - The item to check, with { x, y, width, height }.
     * @returns {number} - The index of the child (0-3) or -1 if it spans multiple children.
     */
    getChildIndex(item) {
        const midX = this.boundary.x + this.boundary.width / 2;
        const midY = this.boundary.y + this.boundary.height / 2;

        const fitsTop = item.y + item.height < midY;
        const fitsBottom = item.y > midY;
        const fitsLeft = item.x + item.width < midX;
        const fitsRight = item.x > midX;

        if (fitsTop && fitsRight) return 0; // Northeast
        if (fitsTop && fitsLeft) return 1; // Northwest
        if (fitsBottom && fitsLeft) return 2; // Southwest
        if (fitsBottom && fitsRight) return 3; // Southeast

        return -1; // Doesn't fit cleanly, belongs to the parent
    }

    /**
     * Inserts an item into the quadtree.
     * @param {object} item - The item to insert, must have x, y, width, height.
     */
    insert(item) {
        if (!this.intersects(item, this.boundary)) {
            return false;
        }

        if (this.divided) {
            const index = this.getChildIndex(item);
            if (index !== -1) {
                // The item fits completely into a child node
                this.children[index].insert(item);
                return;
            }
        }

        // Add the item to this node if it's a leaf or if it spans children
        this.items.push(item);

        // If we've exceeded capacity and we're not yet divided, subdivide
        if (!this.divided && this.items.length > this.capacity && this.level < 8) {
            this.subdivide();
        }
    }

    /**
     * Queries the quadtree for items within a given range, with LOD culling.
     * @param {object} range - The rectangular range to query { x, y, width, height }.
     * @param {number} scale - The current zoom scale of the viewport.
     * @returns {Array} - An array of found items (guaranteed to be unique).
     */
    query(range, scale) {
        const found = new Set();
        this._queryRecursive(range, scale, found);
        return Array.from(found);
    }

    _queryRecursive(range, scale, found) {
        if (!this.intersects(range, this.boundary)) {
            return;
        }

        // **LOD Culling**: If the node's on-screen size is less than a pixel, ignore it.
        const projectedWidth = this.boundary.width * scale;
        if (projectedWidth < 1) {
            return;
        }

        // Add items from the current node that intersect the range
        for (const item of this.items) {
            if (this.intersects(item, range)) {
                found.add(item);
            }
        }

        // If this node is divided, query its children
        if (this.divided) {
            for (const child of this.children) {
                child._queryRecursive(range, scale, found);
            }
        }
    }

    /**
     * Utility function to check for intersection between two rectangles.
     */
    intersects(rect1, rect2) {
        return !(
            rect1.x >= rect2.x + rect2.width || // rect1 is right of rect2
            rect1.x + rect1.width <= rect2.x || // rect1 is left of rect2
            rect1.y >= rect2.y + rect2.height || // rect1 is below rect2
            rect1.y + rect1.height <= rect2.y // rect1 is above rect2
        );
    }
}

/**
 * A reusable, generic modal dialog component.
 */
export class Modal {
    /**
     * @param {HTMLElement} targetElement The element to which the modal will be appended.
     */
    constructor(targetElement) {
        this.targetElement = targetElement;
        
        // Bind methods to ensure `this` is correct in event listeners
        this.show = this.show.bind(this);
        this.hide = this.hide.bind(this);
        this._handleEscKey = this._handleEscKey.bind(this);

        this._initDOMElements();
        this._attachEventListeners();
    }

    /**
     * Creates all the necessary DOM elements for the modal.
     * @private
     */
    _initDOMElements() {
        this.overlayElement = document.createElement('div');
        this.overlayElement.className = "highres-infomodal-overlay";
        this.overlayElement.setAttribute('role', 'dialog');
        this.overlayElement.setAttribute('aria-modal', 'true');

        this.contentElement = document.createElement('div');
        this.contentElement.className = "highres-infomodal-content";

        this.headerElement = document.createElement('header');
        this.headerElement.className = "highres-infomodal-header";
        
        this.titleElement = document.createElement('h2');
        
        this.closeButton = document.createElement('button');
        this.closeButton.className = "highres-infomodal-close";
        this.closeButton.innerHTML = '&times;';
        this.closeButton.setAttribute('aria-label', 'Close dialog');
        
        this.bodyElement = document.createElement('div');
        this.bodyElement.className = "highres-infomodal-body";
        
        // Assemble
        this.headerElement.appendChild(this.titleElement);
        this.headerElement.appendChild(this.closeButton);
        this.contentElement.appendChild(this.headerElement);
        this.contentElement.appendChild(this.bodyElement);
        this.overlayElement.appendChild(this.contentElement);
        this.targetElement.appendChild(this.overlayElement);
    }
    
    /**
     * Attaches event listeners for closing the modal.
     * @private
     */
    _attachEventListeners() {
        this.closeButton.addEventListener('click', this.hide);
        this.overlayElement.addEventListener('click', this.hide);
        // Prevent clicks inside the modal from closing it
        this.contentElement.addEventListener('click', (e) => e.stopPropagation());
    }
    
    /**
     * Handles the Escape key press for closing the modal.
     * @param {KeyboardEvent} e The keyboard event.
     * @private
     */
    _handleEscKey(e) {
        if (e.key === 'Escape') {
            this.hide();
        }
    }

    /**
     * Displays the modal.
     */
    show() {
        this.overlayElement.classList.add('is-visible');
        document.addEventListener('keydown', this._handleEscKey);
    }
    
    /**
     * Hides the modal.
     */
    hide() {
        this.overlayElement.classList.remove('is-visible');
        document.removeEventListener('keydown', this._handleEscKey);
    }
    
    /**
     * Sets the content of the modal.
     * @param {object} content
     * @param {string} content.title The text for the modal's title.
     * @param {HTMLElement|string} content.bodyContent The content for the modal's body. Can be an HTML element or a string.
     */
    setContent({ title, bodyContent }) {
        this.titleElement.textContent = title || '';
        this.bodyElement.innerHTML = ''; // Clear previous content
        
        if (typeof bodyContent === 'string') {
            this.bodyElement.innerHTML = bodyContent;
        } else if (bodyContent instanceof HTMLElement) {
            this.bodyElement.appendChild(bodyContent);
        }
    }
    
    /**
     * Removes the modal from the DOM and cleans up listeners.
     */
    destroy() {
        // In a real app, you might want more robust listener cleanup, but this is a good start.
        document.removeEventListener('keydown', this._handleEscKey);
        this.targetElement.removeChild(this.overlayElement);
    }
}
