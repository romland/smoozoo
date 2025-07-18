/**
 * SelectionDeck Class (Stacking Layout Version)
 *
 * Manages the UI and logic for a "deck" of selected images,
 * using absolute positioning to create a true fanned-out stack effect.
 * Features flyer animation, layout animation, and correct growth direction.
 */
export class SelectionDeck {
    constructor(plugin, options, targetElement) {
        this.plugin = plugin;
        this.api = plugin.api;
        this.options = {
            position: 'bottom-right',
            cardWidth: 80,
            cardHeight: 100,
            maxWidth: 500, // The maximum width the deck can grow to
            defaultOffset: 90, // Space between cards before compressing
            minOffset: 20, // The minimum space between cards when compressed
            ...options
        };
        this.targetElement = targetElement;
        this.container = null;
        this.selectedImages = new Map();
    }

    init() {
        this.injectUI();
        this.applyStyles();
    }

    injectUI() {
        const html = `<div id="smoozoo-deck-container"></div>`;
        this.targetElement.insertAdjacentHTML('beforeend', html);
        this.container = document.getElementById('smoozoo-deck-container');
    }

    applyStyles() {
        const style = this.container.style;
        style.position = 'absolute';
        style.zIndex = '100';
        style.height = `${this.options.cardHeight + 20}px`;
        style.maxWidth = `${this.options.maxWidth}px`; // Enforce the max width
        style.padding = '10px';
        style.pointerEvents = 'auto';
        style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        style.borderRadius = '8px';
        style.transition = 'width 0.3s ease-out';

        const [yPos, xPos] = this.options.position.split('-');
        style[yPos] = '10px';
        style[xPos] = '10px';
    }

    toggle(image) {
        if (!image) return;
        if (this.selectedImages.has(image.id)) {
            this.remove(image);
        } else {
            this.add(image);
        }
        this.api.requestRender();
    }

    isSelected(imageId) {
        return this.selectedImages.has(imageId);
    }

    add(image) {
        if (this.selectedImages.has(image.id)) return;

        const deckCard = this.createDeckCard(image);
        this.container.appendChild(deckCard);
        this.selectedImages.set(image.id, { image, element: deckCard });

        this.animateFlyerAndLayout(deckCard, image);
    }

    remove(image) {
        const selectionData = this.selectedImages.get(image.id);
        if (selectionData) {
            const cardElement = selectionData.element;
            cardElement.style.opacity = '0';
            this.selectedImages.delete(image.id);
            cardElement.addEventListener('transitionend', () => {
                cardElement.remove();
                this.updateDeckLayout(true);
            }, { once: true });
        }
    }

    calculateOffset() {
        const cardCount = this.selectedImages.size;
        if (cardCount <= 1) return this.options.defaultOffset;

        const containerMaxWidth = this.options.maxWidth - 20; // Account for padding
        const cardWidth = this.options.cardWidth;
        const defaultTotalWidth = cardWidth + (cardCount - 1) * this.options.defaultOffset;

        if (defaultTotalWidth <= containerMaxWidth) {
            return this.options.defaultOffset;
        } else {
            const availableSpace = containerMaxWidth - cardWidth;
            const compressedOffset = availableSpace / (cardCount - 1);
            return Math.max(this.options.minOffset, compressedOffset);
        }
    }

    updateDeckLayout(animate = true) {
        const cards = Array.from(this.container.children);
        const offset = this.calculateOffset();
        const cardCount = cards.length;

        // --- FIX: Calculate the container's width correctly and cap it at maxWidth ---
        const desiredWidth = this.options.cardWidth + (cardCount > 1 ? (cardCount - 1) * offset : 0);
        this.container.style.width = `${desiredWidth}px`;

        cards.forEach((card, index) => {
            card.style.transition = animate ? 'right 0.3s ease-out, left 0.3s ease-out, opacity 0.2s' : 'none';
            const reversedIndex = cardCount - 1 - index;
            card.style.right = `${10 + (reversedIndex * offset)}px`;
            card.style.zIndex = index;
        });
    }

animateFlyerAndLayout(deckCard, image) {
    // This first part of the method remains the same
    const { scale, originX, originY } = this.api.getTransform();
    const canvasRect = this.plugin.canvas.getBoundingClientRect();
    const cardOptions = this.options;

    const initialRect = {
        left: (image.x + originX) * scale + canvasRect.left,
        top: (image.y + originY) * scale + canvasRect.top,
        width: image.width * scale,
        height: image.height * scale,
    };

    const finalRect = {
        width: cardOptions.cardWidth,
        height: cardOptions.cardHeight,
        top: this.container.getBoundingClientRect().top + 10,
    };
    const [yPos, xPos] = cardOptions.position.split('-');
    if (xPos === 'right') {
        const cardRightEdge = window.innerWidth - 20;
        finalRect.left = cardRightEdge - cardOptions.cardWidth;
    } else {
        const lastCardIndex = this.selectedImages.size - 1;
        const offset = this.calculateOffset();
        finalRect.left = this.container.getBoundingClientRect().left + 10 + (lastCardIndex * offset);
    }

    const flyer = this.createDeckCard(image);
    flyer.style.position = 'fixed';
    flyer.style.zIndex = '101';
    flyer.style.left = `${finalRect.left}px`;
    flyer.style.top = `${finalRect.top}px`;
    flyer.style.opacity = '1';

    const scaleX = initialRect.width / finalRect.width;
    const scaleY = initialRect.height / finalRect.height;
    const translateX = initialRect.left - finalRect.left;
    const translateY = initialRect.top - finalRect.top;
    flyer.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`;

    document.body.appendChild(flyer);

    requestAnimationFrame(() => {
        this.updateDeckLayout(true);
        flyer.style.transition = 'transform 0.6s ease-out';
        flyer.style.transform = 'translate(0, 0) scale(1)';
    });


    // --- UPDATED CLEANUP LOGIC ---
    // This now performs a seamless crossfade to eliminate the flicker.
    flyer.addEventListener('transitionend', () => {
        // 1. Fade in the permanent card that's already in position.
        deckCard.style.transition = 'opacity 0.15s ease-out';
        deckCard.style.opacity = '1';

        // 2. Simultaneously, fade out the flyer.
        flyer.style.transition = 'opacity 0.15s ease-out';
        flyer.style.opacity = '0';

        // 3. Remove the flyer from the DOM *after* it has finished fading out.
        flyer.addEventListener('transitionend', () => {
            if (flyer.parentNode) flyer.remove();
        }, { once: true });

    }, { once: true });
}
    createDeckCard(image) {
        const deckCard = document.createElement('div');
        deckCard.className = 'smoozoo-deck-card';
        deckCard.style.position = 'absolute';
        deckCard.style.width = `${this.options.cardWidth}px`;
        deckCard.style.height = `${this.options.cardHeight}px`;
        deckCard.style.top = '10px';
        deckCard.style.border = '2px solid white';
        deckCard.style.borderRadius = '8px';
        deckCard.style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)';
        deckCard.style.backgroundColor = '#333';
        deckCard.style.opacity = '0'; // Permanent card starts invisible

        const deckThumb = document.createElement('img');
        deckThumb.src = this.plugin.config.apiOrigin + (image.thumb || image.highRes);
        deckThumb.style.width = '100%';
        deckThumb.style.height = '100%';
        deckThumb.style.objectFit = 'cover';
        deckThumb.style.borderRadius = '6px';

        deckCard.appendChild(deckThumb);
        return deckCard;
    }
}