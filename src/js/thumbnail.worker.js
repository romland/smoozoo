// This worker downloads an image and creates thumbnail pixel data.

self.onmessage = async (event) => {
    // Now accepting 'id' from the main thread
    const { id, imageUrl, thumbnailSize } = event.data;

    try {
        const response = await fetch(imageUrl);
        if (!response.ok) {
            // Throw an error if the fetch resulted in a 404 or other HTTP error
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const blob = await response.blob();
        const imageBitmap = await createImageBitmap(blob);

        const ratio = imageBitmap.width / imageBitmap.height;
        let thumbWidth, thumbHeight;
        if (ratio > 1) { // Landscape
            thumbWidth = thumbnailSize;
            thumbHeight = Math.round(thumbnailSize / ratio);
        } else { // Portrait or square
            thumbHeight = thumbnailSize;
            thumbWidth = Math.round(thumbnailSize * ratio);
        }

        const canvas = new OffscreenCanvas(thumbWidth, thumbHeight);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imageBitmap, 0, 0, thumbWidth, thumbHeight);

        const imageData = ctx.getImageData(0, 0, thumbWidth, thumbHeight);
        
        // Include the 'id' when sending data back
        self.postMessage({
            status: 'success',
            id: id, // Pass the id back
            imageUrl: imageUrl,
            pixelData: imageData,
            width: thumbWidth,
            height: thumbHeight,
        }, [imageData.data.buffer]);

    } catch (error) {
        console.error(`Worker failed for ${imageUrl}:`, error.message);
        // Also include the 'id' on error
        self.postMessage({ status: 'error', id: id, imageUrl: imageUrl, error: error.message });
    }
};