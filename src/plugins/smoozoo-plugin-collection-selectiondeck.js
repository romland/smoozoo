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
  animate to the left (or right) (to their new end position)
- Would it be too costly to give an indicator on the "real canvas" which images are 
  selected?
  -- also, if a change like this would require huge changes in the code, I don't think
  it's worth it. But if you can think of a tiny-impact kind of way, great.
- I want to be able to specify how many rows the selected deck can be too -- the IDEAL
  way is that the images start stacking above eachother -- if there are too many. In
  most cases I will want to have just 1 row. For the record.

Step 4.
-  Earlier -- Oh, you misunderstood me, the selected image that flew to the deck was awesome! I was talking about the cards already _in_ the deck, how they should animate instead of just plop to their new position 

- It seems the _first_ selected image does not fly down there -- is that possible?

Step 5.
- the deck should probably have an overflow set to none 
- the images don't really stack like a deck of cards (you know how you drag a 
  deck of cards and you only see an edge of each card -- except the top 
  one -- which you see in full). This should then respect the constraints of
  the width of the container.
  As I type this, I realize this is hard to make it look good. Hmm. Seeing as
  the images have different aspect ratios? Is what I am asking for even doable?

...next
So, in my example here, for some reason, the first image added to the deck gets a landscape shape but all subsequent ones are in portrait -- so the deck looks very weird with that first card 
There are no broken images. It just adds the first image to the deck in a landscape shape -- despite it even being a portrait shaped thumbnail 

...next
Newly selected images still fly outside the deck after a while, they existing images in the deck should move out of the way to make room for the new one -- until there is no new room, then they can lie "spread out so only an edge of each card is seen" -- but the _last_ card is always fully visible -- since it's on top


*/

/**
 * SelectionDeck Class (Stacking Layout Version)
 *
 * Manages the UI and logic for a "deck" of selected images,
 * using absolute positioning to create a true fanned-out stack effect.
 * Features flyer animation, layout animation, and correct growth direction.
 */
/**
 * SelectionDeck Class (Two-Phase Stacking Layout)
 *
 * Manages the UI and logic for a "deck" of selected images.
 * Phase 1: Expands to show full cards until a max-width is reached.
 * Phase 2: Compresses cards into a fanned-out stack.
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
        // Animate the container's width for a smooth expansion effect
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

        // Create and add the card; it will be positioned by updateDeckLayout
        const deckCard = this.createDeckCard(image);
        this.container.appendChild(deckCard);
        this.selectedImages.set(image.id, { image, element: deckCard });

        // Animate the flyer AND the layout of existing cards
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
                this.updateDeckLayout(true); // Animate remaining cards into place
            }, { once: true });
        }
    }

    /**
     * Calculates the required offset between cards based on the container's state.
     */
    calculateOffset() {
        const cardCount = this.selectedImages.size;
        if (cardCount <= 1) return this.options.defaultOffset;

        const containerMaxWidth = this.options.maxWidth - 20; // Account for padding
        const cardWidth = this.options.cardWidth;
        const defaultTotalWidth = cardWidth + (cardCount - 1) * this.options.defaultOffset;

        let offset;
        if (defaultTotalWidth <= containerMaxWidth) {
            // Phase 1: There's enough room, use the default offset
            offset = this.options.defaultOffset;
        } else {
            // Phase 2: Not enough room, compress the stack
            const availableSpace = containerMaxWidth - cardWidth;
            const compressedOffset = availableSpace / (cardCount - 1);
            offset = Math.max(this.options.minOffset, compressedOffset);
        }
        return offset;
    }

    updateDeckLayout(animate = true) {
        const cards = Array.from(this.container.children);
        const offset = this.calculateOffset();
        const [yPos, xPos] = this.options.position.split('-');

        // Update container width to fit all cards
        const newContainerWidth = this.options.cardWidth + (cards.length - 1) * offset;
        this.container.style.width = `${newContainerWidth}px`;

        cards.forEach((card, index) => {
            card.style.transition = animate ? 'right 0.3s ease-out, left 0.3s ease-out, opacity 0.2s' : 'opacity 0.2s';
            // Position from the right edge, ensuring the last card (highest index) is most visible
            const reversedIndex = cards.length - 1 - index;
            card.style.right = `${10 + (reversedIndex * offset)}px`;
            card.style.zIndex = index;
        });
    }

    animateFlyerAndLayout(deckCard, image) {
        // --- Create the Flyer ---
        const { scale, originX, originY } = this.api.getTransform();
        const canvasRect = this.plugin.canvas.getBoundingClientRect();
        const flyer = document.createElement('img');
        flyer.src = this.plugin.config.apiOrigin + (image.thumb || image.highRes);
        flyer.style.position = 'fixed';
        flyer.style.left = `${(image.x + originX) * scale + canvasRect.left}px`;
        flyer.style.top = `${(image.y + originY) * scale + canvasRect.top}px`;
        flyer.style.width = `${image.width * scale}px`;
        flyer.style.height = `${image.height * scale}px`;
        flyer.style.zIndex = '101';
        flyer.style.transition = 'all 0.6s cubic-bezier(0.5, 0, 0.1, 1)';
        flyer.style.borderRadius = '5px';
        document.body.appendChild(flyer);
        flyer.offsetHeight; // Force reflow

        // --- Animate Layout and Flyer ---
        this.updateDeckLayout(true); // Animate existing cards to new positions

        // Because the final card's position is predictable (always on the far right),
        // we can calculate its destination without waiting for a frame.
        const containerRect = this.container.getBoundingClientRect();
        const destinationX = containerRect.right - this.options.cardWidth - 10; // 10 for padding
        const destinationY = containerRect.top + 10;

        requestAnimationFrame(() => {
            flyer.style.left = `${destinationX}px`;
            flyer.style.top = `${destinationY}px`;
            flyer.style.width = `${this.options.cardWidth}px`;
            flyer.style.height = `${this.options.cardHeight}px`;
        });

        flyer.addEventListener('transitionend', () => {
            deckCard.style.opacity = '1';
            if (flyer.parentNode) flyer.remove();
        }, { once: true });
    }

    createDeckCard(image) {
        const deckCard = document.createElement('div');
        deckCard.className = 'smoozoo-deck-card';
        deckCard.style.width = `${this.options.cardWidth}px`;
        deckCard.style.height = `${this.options.cardHeight}px`;
        deckCard.style.position = 'absolute';
        deckCard.style.top = '10px';
        deckCard.style.border = '2px solid white';
        deckCard.style.borderRadius = '8px';
        deckCard.style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)';
        deckCard.style.backgroundColor = '#333';
        deckCard.style.opacity = '0'; // Start invisible

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