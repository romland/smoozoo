
/**
 * SelectionDeck Class
 *
 * Manages the UI and logic for a "deck" of selected images.
 * It handles adding/removing images with a "fly-to" animation.
 */
export class SelectionDeck {
    constructor(plugin, options, targetElement) {
        this.plugin = plugin;
        this.api = plugin.api;
        this.options = {
            position: 'bottom-right',
            thumbSize: 80,
            maxWidth: '400px',
            maxRows: 1, // New: control how many rows are visible
            ...options
        };
        this.targetElement = targetElement;
        this.container = null;
        this.selectedImages = new Map();
    }

    /**
     * Creates and injects the deck's UI into the DOM.
     */
    init() {
        this.injectUI();
        this.applyStyles();
    }

    injectUI() {
        const html = `<div id="smoozoo-deck-container"></div>`;
        this.targetElement.insertAdjacentHTML('beforeend', html);
        this.container = document.getElementById('smoozoo-deck-container');
    }


    /**
     * Applies CSS styles to the deck container based on configuration.
     */
    applyStyles() {
        const style = this.container.style;
        style.position = 'absolute';
        style.zIndex = '100';
        style.maxWidth = this.options.maxWidth;
        // Calculate max-height based on rows and thumb size
        const cardHeight = this.options.thumbSize;
        const overlap = 50; // How much cards overlap vertically
        style.maxHeight = `${this.options.maxRows * (cardHeight - overlap) + overlap + 20}px`;
        style.overflowY = 'auto';

        style.display = 'flex';
        style.flexWrap = 'wrap';
        style.padding = '10px';
        style.pointerEvents = 'auto';

        const [yPos, xPos] = this.options.position.split('-');
        style[yPos] = '10px';
        style[xPos] = '10px';
    }

    /**
     * Toggles the selection state of an image.
     * @param {object} image The image object to add or remove.
     */
    toggle(image) {
        if (!image) return;
        if (this.selectedImages.has(image.id)) {
            this.remove(image);
        } else {
            this.add(image);
        }
        // Redraw to update the dimming effect on the canvas
        this.api.requestRender();
    }

    /**
     * Checks if a given image is currently in the selection deck.
     * @param {string} imageId The ID of the image to check.
     * @returns {boolean}
     */
    isSelected(imageId) {
        return this.selectedImages.has(imageId);
    }


    /**
     * Adds an image to the deck with a "fly-to" animation.
     * @param {object} image The image object to add.
     */
add(image) {
    if (this.selectedImages.has(image.id)) return;

    // --- Part 1: Record initial state (FLIP) ---
    const existingCards = new Map();
    this.container.querySelectorAll('.smoozoo-deck-card').forEach(card => {
        existingCards.set(card, card.getBoundingClientRect());
    });

    // --- Part 2: Create the "Flyer" element ---
    const { scale, originX, originY } = this.api.getTransform();
    const canvasRect = this.plugin.canvas.getBoundingClientRect();
    const flyer = document.createElement('img');
    flyer.src = this.plugin.config.apiOrigin + image.thumb;
    flyer.style.position = 'fixed';
    flyer.style.left = `${(image.x + originX) * scale + canvasRect.left}px`;
    flyer.style.top = `${(image.y + originY) * scale + canvasRect.top}px`;
    flyer.style.width = `${image.width * scale}px`;
    flyer.style.height = `${image.height * scale}px`;
    flyer.style.zIndex = '101';
    flyer.style.transition = 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
    flyer.style.pointerEvents = 'none';
    flyer.style.objectFit = 'cover';
    flyer.style.borderRadius = '3px';
    document.body.appendChild(flyer);

    // --- FIX: Force the browser to apply the initial styles ---
    // Reading a property like offsetHeight makes the browser complete the render
    // before moving on, ensuring the transition will fire correctly.
    flyer.offsetHeight;

    // --- Part 3: Add the permanent card to the DOM ---
    const deckCard = this.createDeckCard(image);
    this.container.appendChild(deckCard);
    this.selectedImages.set(image.id, { image, element: deckCard });
    const deckCardRect = deckCard.getBoundingClientRect();

    // --- Part 4: Invert positions of existing cards (FLIP) ---
    existingCards.forEach((firstPos, card) => {
        const lastPos = card.getBoundingClientRect();
        const deltaX = firstPos.left - lastPos.left;
        const deltaY = firstPos.top - lastPos.top;
        if (deltaX !== 0 || deltaY !== 0) {
            card.style.transition = 'transform 0s';
            card.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
        }
    });

    // --- Part 5: Play all animations ---
    requestAnimationFrame(() => {
        flyer.style.left = `${deckCardRect.left}px`;
        flyer.style.top = `${deckCardRect.top}px`;
        flyer.style.width = `${deckCardRect.width}px`;
        flyer.style.height = `${deckCardRect.height}px`;

        existingCards.forEach((_, card) => {
            card.style.transition = 'transform 0.3s ease-out';
            card.style.transform = '';
        });
    });

    // --- Part 6: Cleanup ---
    flyer.addEventListener('transitionend', () => {
        deckCard.style.opacity = '1';
        deckCard.style.transform = 'scale(1)';
        if (flyer.parentNode) {
            flyer.remove();
        }
    }, { once: true });
}

    createDeckCard(image) {
        const deckCard = document.createElement('div');
        deckCard.className = 'smoozoo-deck-card';
        deckCard.style.width = `${this.options.thumbSize}px`;
        deckCard.style.height = `${this.options.thumbSize}px`;
        deckCard.style.border = '2px solid white';
        deckCard.style.borderRadius = '5px';
        deckCard.style.boxShadow = '0 0 10px rgba(0,0,0,0.5)';
        deckCard.style.transition = 'transform 0.3s ease-out, opacity 0.3s';
        deckCard.style.backgroundColor = '#333';
        deckCard.style.opacity = '0'; // Start invisible
        deckCard.style.transform = 'scale(0.5)';
        
        // Stacking logic
        deckCard.style.marginLeft = this.container.children.length > 0 ? '-40px' : '0';
        deckCard.style.marginTop = '-50px'; // Overlap vertically

        const deckThumb = document.createElement('img');
        deckThumb.src = this.plugin.config.apiOrigin + image.thumb;
        deckThumb.style.width = '100%';
        deckThumb.style.height = '100%';
        deckThumb.style.objectFit = 'cover';
        deckThumb.style.borderRadius = '3px';

        deckCard.appendChild(deckThumb);
        return deckCard;
    }


    /**
     * Removes an image from the deck.
     * @param {object} image The image object to remove.
     */
    remove(image) {
        const selectionData = this.selectedImages.get(image.id);
        if (selectionData) {
            const { element: deckCard } = selectionData;
            deckCard.style.opacity = '0';
            deckCard.style.transform = 'scale(0.5)';
            deckCard.addEventListener('transitionend', () => deckCard.remove(), { once: true });
            this.selectedImages.delete(image.id);
        }
    }


    updateCardMargins() {
        let isFirst = true;
        this.container.querySelectorAll('.smoozoo-deck-card').forEach(card => {
            card.style.marginLeft = isFirst ? '0' : '-30px';
            isFirst = false;
        });
    }    
}