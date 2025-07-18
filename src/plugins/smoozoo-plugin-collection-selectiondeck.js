/**
 * SelectionDeck Class - Stacking Layout Version
 *
 * Manages the UI and logic for a "deck" of selected images,
 * using absolute positioning to create a true fanned-out stack effect.
 */
export class SelectionDeck
{
    constructor(plugin, options, targetElement)
    {
        this.plugin = plugin;
        this.api = plugin.api;
        this.options = {
            position: 'bottom-right',
            cardWidth: 80,
            cardHeight: 100,
            maxWidth: 200,
            defaultOffset: 90,
            minOffset: 20,
            ...options
        };
        this.targetElement = targetElement;
        this.container = null;
        this.selectedImages = new Map();
    }


init() {
    this.injectUI();
    this.applyStyles();

    const menuButton = document.getElementById('smoozoo-deck-menu-btn');
    const menuPanel = document.getElementById('smoozoo-deck-actions-menu');

    // Logic to open/close the menu
    menuButton.addEventListener('click', (e) => {
        e.stopPropagation();
        menuPanel.classList.toggle('visible');
    });

    // Logic to handle clicks on actions inside the menu
    menuPanel.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        if (action === 'tag') {
            this.plugin.tagSelectedDeckImages();
        } else if (action === 'clear') {
            this.clearAll();
        }
        // Hide menu after action
        menuPanel.classList.remove('visible');
    });

    // Global listener to close the menu
    document.addEventListener('click', () => {
        if (menuPanel.classList.contains('visible')) {
            menuPanel.classList.remove('visible');
        }
    });
    
    // The call to load from localStorage remains in your SmoozooCollection's init
}


    // Load selection from localStorage
    loadSelection()
    {
        const savedIdsJson = localStorage.getItem('smoozooDeckSelection');
        if (savedIdsJson) {
            const savedIds = JSON.parse(savedIdsJson);
            if (!savedIds || savedIds.length === 0) return;

            savedIds.forEach(id => {
                // Find the full image object from the now-populated main list
                const image = this.plugin.images.find(img => img.id === id);
                if (image) {
                    // Add the card to the deck without the flyer animation
                    const card = this.createDeckCard(image);
                    card.style.opacity = '1';
                    this.container.appendChild(card);
                    this.selectedImages.set(id, { image, element: card });
                }
            });
            // Update the layout once all saved cards have been added
            this.updateDeckLayout(false);
        }
    }


    injectUI() {
        const html = `
            <div id="smoozoo-deck-container">
                <div id="smoozoo-deck-actions-menu" class="smoozoo-deck-menu">
                    <button data-action="tag">Tag Selection</button>
                    <button data-action="clear">Clear Selection</button>
                </div>
                <button id="smoozoo-deck-menu-btn" title="Actions">
                    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>
                </button>
                <div id="smoozoo-deck-count"></div>
            </div>
        `;
        this.targetElement.insertAdjacentHTML('beforeend', html);
        this.container = document.getElementById('smoozoo-deck-container');
    }


    applyStyles()
    {
        const style = this.container.style;
        style.position = 'absolute';
        style.zIndex = '100';
        style.height = `${this.options.cardHeight + 20}px`;
        style.maxWidth = `${this.options.maxWidth}px`;
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
        if (!image) {
            return;
        }

        if (this.selectedImages.has(image.id)) {
            this.remove(image);
        } else {
            this.add(image);
        }

        // This ensures the main canvas redraws to show the dimming effect
        this.api.requestRender();
    }


    add(image)
    {
        if (this.selectedImages.has(image.id)) {
            return;
        }

        // This ensures the card that fades in has the correct picture.
        const deckCard = this.createDeckCard(image);

        this.container.appendChild(deckCard);
        this.selectedImages.set(image.id, { image, element: deckCard });
        this.animateFlyerAndLayout(deckCard, image);

        this._saveSelection();
    }


    remove(image) {
        const selectionData = this.selectedImages.get(image.id);

        if (selectionData) {
            const cardElement = selectionData.element;

            if (cardElement.dataset.objectUrl) {
                URL.revokeObjectURL(cardElement.dataset.objectUrl);
            }

            // 1. Define the specific transition for this removal animation.
            //    This temporarily overrides any existing transitions.
            cardElement.style.transition = 'transform 0.3s ease-out, opacity 0.3s ease-out';

            // 2. Apply the styles that trigger the animation.
            cardElement.style.transform = 'translateY(20px)';
            cardElement.style.opacity = '0';

            this.selectedImages.delete(image.id);

            // 3. The listener waits for our new animation to finish, then cleans up.
            cardElement.addEventListener('transitionend', () => {
                cardElement.remove();
                this.updateDeckLayout(true);
                this._saveSelection();
            }, { once: true });
        }
    }


    calculateOffset()
    {
        const cardCount = this.selectedImages.size;

        if (cardCount <= 1) {
            return this.options.defaultOffset;
        }

        const containerMaxWidth = this.options.maxWidth - 20;
        const cardWidth = this.options.cardWidth;
        const defaultTotalWidth = cardWidth + (cardCount - 1) * this.options.defaultOffset;
        
        if (defaultTotalWidth <= containerMaxWidth) {
            return this.options.defaultOffset;
        } else {
            const availableSpace = containerMaxWidth - cardWidth;
            const compressedOffset = cardCount > 1 ? availableSpace / (cardCount - 1) : 0;
            return Math.max(this.options.minOffset, compressedOffset);
        }
    }


    updateDeckLayout(animate = true) {
        const menuButton = document.getElementById('smoozoo-deck-menu-btn');
        const cards = this.container.querySelectorAll('.smoozoo-deck-card');
        const cardCount = cards.length;

        // Show menu button only if there are cards
        if (menuButton) menuButton.style.display = cardCount > 0 ? 'block' : 'none';

        // Show buttons only if there are cards
        const hasCards = cardCount > 0;
        // if (clearButton) clearButton.style.display = hasCards ? 'block' : 'none';
        if (menuButton) menuButton.style.display = hasCards ? 'block' : 'none';
        
        // ... rest of the method is unchanged ...
        const counter = this.container.querySelector('#smoozoo-deck-count');
        if (cardCount === 0) {
            this.container.style.width = '0px';
            if (counter) counter.style.display = 'none';
            return;
        }
        const { cardWidth, defaultOffset, maxWidth } = this.options;
        const containerContentWidth = maxWidth - 20;
        const uncompressedWidth = cardWidth + (cardCount - 1) * defaultOffset;
        let finalOffset;
        let finalContainerWidth;
        if (uncompressedWidth <= containerContentWidth) {
            finalOffset = defaultOffset;
            finalContainerWidth = uncompressedWidth;
            if (counter) counter.style.display = 'none';
        } else {
            finalContainerWidth = containerContentWidth;
            const availableSpace = finalContainerWidth - cardWidth;
            finalOffset = cardCount > 1 ? availableSpace / (cardCount - 1) : 0;
            if (counter) {
                counter.textContent = cardCount;
                counter.style.display = 'block';
            }
        }
        this.container.style.width = `${finalContainerWidth}px`;
        cards.forEach((card, index) => {
            card.style.transition = animate ? 'right 0.3s ease-out, opacity 0.2s' : 'none';
            const reversedIndex = cardCount - 1 - index;
            card.style.right = `${10 + (reversedIndex * finalOffset)}px`;
            card.style.zIndex = index;
        });
    }


    animateFlyerAndLayout(deckCard, image)
    {
        const { scale, originX, originY } = this.api.getTransform();
        const canvasRect = this.plugin.canvas.getBoundingClientRect();
        const cardOptions = this.options;

        // --- Part 1: Calculate initial and final geometry ---
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

        // --- Part 2: Create the Flyer ---
        const flyer = this.createDeckCard(image);
        flyer.style.position = 'fixed';
        flyer.style.zIndex = '101';
        flyer.style.left = `${finalRect.left}px`;
        flyer.style.top = `${finalRect.top}px`;
        flyer.style.opacity = '1';
        
        // --- Part 3: Calculate transform based on CENTERS for perfect alignment ---
        const initialCenterX = initialRect.left + initialRect.width / 2;
        const initialCenterY = initialRect.top + initialRect.height / 2;
        const finalCenterX = finalRect.left + finalRect.width / 2;
        const finalCenterY = finalRect.top + finalRect.height / 2;

        const scaleX = initialRect.width / finalRect.width;
        const scaleY = initialRect.height / finalRect.height;
        const translateX = initialCenterX - finalCenterX;
        const translateY = initialCenterY - finalCenterY;
        
        flyer.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`;
        
        document.body.appendChild(flyer);

        // --- Part 4: Animate ---
        requestAnimationFrame(() => {
            this.updateDeckLayout(true);
            flyer.style.transition = 'transform 0.6s ease-out';
            flyer.style.transform = 'translate(0, 0) scale(1)';
        });

        // --- Part 5: Cleanup ---
        flyer.addEventListener('transitionend', () => {
            deckCard.style.transition = 'opacity 0.015s ease-out';
            deckCard.style.opacity = '1';
            flyer.style.transition = 'opacity 0.015s ease-out';
            flyer.style.opacity = '0';
            flyer.addEventListener('transitionend', () => {
                if (flyer.parentNode) flyer.remove();
            }, { once: true });
        }, { once: true });
    }


    createDeckCard(image) {
        const deckCard = document.createElement('div');
        deckCard.className = 'smoozoo-deck-card';

        deckCard.style.position = 'absolute';
        deckCard.style.boxSizing = 'border-box';
        deckCard.style.width = `${this.options.cardWidth}px`;
        deckCard.style.height = `${this.options.cardHeight}px`;
        deckCard.style.top = '10px';
        deckCard.style.border = '2px solid white';
        deckCard.style.borderRadius = '8px';
        deckCard.style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)';
        deckCard.style.backgroundColor = '#333';
        deckCard.style.opacity = '0';

        const deckThumb = document.createElement('img');

        // Use the passed-in image data to set the source
        if (image) {
            // Check for the pre-loaded URL first.
            if (image.thumbObjectUrl) {
                deckThumb.src = image.thumbObjectUrl;
            } else {
                // Fallback to the original network request method.
                deckThumb.src = this.plugin.config.apiOrigin + (image.thumb || image.highRes);
            }
        }
        deckThumb.style.width = '100%';
        deckThumb.style.height = '100%';
        deckThumb.style.objectFit = 'cover';
        deckThumb.style.borderRadius = '6px';

        deckCard.appendChild(deckThumb);
        return deckCard;
    }
        
    isSelected(imageId) {
        return this.selectedImages.has(imageId);
    }

    _saveSelection() {
        const ids = Array.from(this.selectedImages.keys());
        if (ids.length > 0) {
            localStorage.setItem('smoozooDeckSelection', JSON.stringify(ids));
        } else {
            localStorage.removeItem('smoozooDeckSelection');
        }
    }

    clearAll() {
        const cards = this.container.querySelectorAll('.smoozoo-deck-card');
        
        if (cards.length === 0) {
            return;
        }

        // Start the removal animation on all cards at once.
        cards.forEach(card => {
            card.classList.add('removing');
        });

        // Clear the logical state immediately.
        this.selectedImages.clear();
        this._saveSelection();
        
        // After 350ms (just longer than the 0.3s animation), clean up the DOM.
        setTimeout(() => {
            // Remove all the animated card elements.
            cards.forEach(card => card.remove());

            // Update the layout for the now-empty deck.
            this.updateDeckLayout(false);
            
            // Redraw the main canvas.
            this.api.requestRender();
        }, 350);
    }
}
