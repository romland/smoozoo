// This worker downloads an image and creates thumbnail pixel data.

self.onmessage = async (event) => {
    const { imageUrl, thumbnailSize } = event.data;
console.log({imageUrl})
    try {
        // 1. Download the image data in the worker
        const response = await fetch(imageUrl);
        const blob = await response.blob();

        // 2. Decode the image into a bitmap off the main thread
        const imageBitmap = await createImageBitmap(blob);

        // 3. Calculate aspect-ratio correct dimensions
        const ratio = imageBitmap.width / imageBitmap.height;
        let thumbWidth, thumbHeight;
        if (ratio > 1) { // Landscape
            thumbWidth = thumbnailSize;
            thumbHeight = Math.round(thumbnailSize / ratio);
        } else { // Portrait or square
            thumbHeight = thumbnailSize;
            thumbWidth = Math.round(thumbnailSize * ratio);
        }

        // 4. Use an OffscreenCanvas for rendering (designed for workers)
        const canvas = new OffscreenCanvas(thumbWidth, thumbHeight);
        const ctx = canvas.getContext('2d');
        
        // 5. Draw the bitmap to the offscreen canvas to resize it
        ctx.drawImage(imageBitmap, 0, 0, thumbWidth, thumbHeight);

        // 6. Get the raw pixel data
        const imageData = ctx.getImageData(0, 0, thumbWidth, thumbHeight);
        
        // 7. Send the finished data back to the main thread.
        // The imageData.data.buffer is marked as "transferable" for a zero-copy, instant transfer.
        self.postMessage({
            status: 'success',
            imageUrl: imageUrl,
            pixelData: imageData,
            width: thumbWidth,
            height: thumbHeight,
        }, [imageData.data.buffer]);

    } catch (error) {
        console.error(`Worker failed for ${imageUrl}:`, error);
        self.postMessage({ status: 'error', imageUrl: imageUrl, error: error.message });
    }
};
