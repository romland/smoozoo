/*
Step 1.
So, I have this plugin, there is currently some "selection" code in there -- I need to get rid of that. We will revisit the whole "drag to select" later on. So let's ditch all that.

But, what I _do_ want now is that I can press a key (say 'space') to select a picture and it will fly to some container in a configurable corner of the screen. There a "deck" of selected images will sit which I will later on want to perform some actions on. 

Step 2.
alright, nice-to-have's:
- first of all, real bug: The aspect ratio is not correct, and it seems to change
  depending on what images appear in the "deck"
- real problem: it should look where mouse pointer is on desktop, and that is the
  image that should go into deck -- if that was the intention with the current code,
  then it is not working
- the deck's width should be adjustable -- perhaps I don't want it to take up
  entire width
- when allowed width of the deck is taken, place images above each-other (like in
  a deck of cards -- not sure how to simulate that look -- perhaps with a border/shadow?)

Step 3.
- When a new picture lands in the deck, I want the existing images already in there to
  animate to the right (to their new end position)
- Would it be too costly to give an indicator on the "real canvas" which images are 
  selected?
  -- also, if a change like this would require huge changes in the code, I don't think
  it's worth it. But if you can think of a tiny-impact kind of way, great.

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
            maxWidth: '50%', // New: control the max width of the deck
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
        style.display = 'flex';
        style.flexWrap = 'wrap'; // Allow items to wrap to the next line
        style.padding = '10px';
        style.pointerEvents = 'auto';

        const [yPos, xPos] = this.options.position.split('-');
        style[yPos] = '10px';
        style[xPos] = '10px';
        
        // Adjust flex alignment for stacking effect
        if (yPos === 'bottom') {
           style.alignItems = 'flex-end';
        } else {
           style.alignItems = 'flex-start';
        }
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

        // 1. Get source image position on screen for the "flyer"
        const {
            scale,
            originX,
            originY
        } = this.api.getTransform();
        const canvasRect = this.plugin.canvas.getBoundingClientRect();

        const screenX = (image.x + originX) * scale + canvasRect.left;
        const screenY = (image.y + originY) * scale + canvasRect.top;
        const screenWidth = image.width * scale;
        const screenHeight = image.height * scale;

        // 2. Create the "flyer" element that animates
        const flyer = document.createElement('img');
        flyer.src = this.plugin.config.apiOrigin + image.thumb;
        flyer.style.position = 'fixed';
        flyer.style.left = `${screenX}px`;
        flyer.style.top = `${screenY}px`;
        flyer.style.width = `${screenWidth}px`;
        flyer.style.height = `${screenHeight}px`;
        flyer.style.zIndex = '101';
        flyer.style.transition = 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
        flyer.style.pointerEvents = 'none';
        flyer.style.objectFit = 'cover';
        document.body.appendChild(flyer);

        // 3. Create a "card" container for the thumbnail for better styling
        const deckCard = document.createElement('div');
        deckCard.className = 'smoozoo-deck-card';
        deckCard.style.width = `${this.options.thumbSize}px`;
        deckCard.style.height = `${this.options.thumbSize}px`;
        // Overlap all cards except the very first one
        deckCard.style.marginLeft = this.container.children.length > 0 ? '-30px' : '0';
        deckCard.style.border = '2px solid white';
        deckCard.style.borderRadius = '5px';
        deckCard.style.boxShadow = '0 0 10px rgba(0,0,0,0.5)';
        deckCard.style.overflow = 'hidden';
        deckCard.style.backgroundColor = '#333';
        deckCard.style.transition = 'all 0.3s';
        deckCard.style.opacity = '0';
        deckCard.style.transform = 'scale(0.5)';

        // 4. Create the image element itself
        const deckThumb = document.createElement('img');
        deckThumb.src = this.plugin.config.apiOrigin + image.thumb;
        deckThumb.style.width = '100%';
        deckThumb.style.height = '100%';
        deckThumb.style.objectFit = 'cover'; // Fixes aspect ratio issue

        deckCard.appendChild(deckThumb);
        this.container.appendChild(deckCard);
        this.selectedImages.set(image.id, {
            image,
            element: deckCard
        });

        // 5. Animate the flyer to the card's destination
        // Use requestAnimationFrame to ensure the card is in the DOM to get its rect
        requestAnimationFrame(() => {
            const deckCardRect = deckCard.getBoundingClientRect();
            flyer.style.left = `${deckCardRect.left}px`;
            flyer.style.top = `${deckCardRect.top}px`;
            flyer.style.width = `${deckCardRect.width}px`;
            flyer.style.height = `${deckCardRect.height}px`;
            flyer.style.opacity = '0.8';
            flyer.style.borderRadius = '4px';
        });

        // 6. Cleanup after animation
        flyer.addEventListener('transitionend', () => {
            deckCard.style.opacity = '1';
            deckCard.style.transform = 'scale(1)';
            if (flyer.parentNode) {
                flyer.remove();
            }
        }, {
            once: true
        });
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
            deckCard.addEventListener('transitionend', () => {
                deckCard.remove();
                 // Re-apply margins to fix gaps
                this.updateCardMargins();
            }, { once: true });
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