import { fetchMultipleImageInfo } from './smoozoo-plugin-collection-helpers.js';

/**
 * A cache for storing and retrieving detailed image information from the API.
 * This class handles batching requests and avoids redundant fetches.
 */
export class ImageInfoCache {
    /**
     * @param {string} apiOrigin - The base URL for the API.
     */
    constructor(apiOrigin) {
        this.apiOrigin = apiOrigin;
        this.cache = new Map(); // Key: imageId, Value: imageDetails object
    }

    /**
     * Gets information for one or more image IDs.
     * It intelligently checks the cache first and only fetches data for IDs that are not already cached.
     *
     * @param {string[]} ids - An array of image IDs to retrieve information for.
     * @returns {Promise<Map<string, object>>} A promise that resolves to a map,
     * where keys are image IDs and values are their corresponding detail objects.
     */
    async getInfo(ids) {
        const idsToFetch = [];
        const results = new Map();
        const idArray = Array.isArray(ids) ? ids : [ids]; // Ensure we have an array

        // First, check the cache for existing data and identify what's missing.
        for (const id of idArray) {
            if (this.cache.has(id)) {
                results.set(id, this.cache.get(id));
            } else {
                idsToFetch.push(id);
            }
        }

        // If there are any IDs that weren't in the cache, fetch them in a single batch.
        if (idsToFetch.length > 0) {
            try {
                // Use the batch-fetching helper function.
                const fetchedDetailsArray = await fetchMultipleImageInfo(this.apiOrigin, idsToFetch);

                // Populate the cache and the results map with the new data.
                for (const details of fetchedDetailsArray) {
                    if (details && details.id) {
                        this.cache.set(details.id, details);
                        results.set(details.id, details);
                    }
                }
            } catch (error) {
                console.error(`Failed to fetch image info for IDs: ${idsToFetch.join(', ')}`, error);
            }
        }

        return results;
    }

    /**
     * A convenience method for retrieving details for a single image.
     *
     * @param {string} id - The ID of the single image.
     * @returns {Promise<object|null>} A promise that resolves to the image details object, or null if not found.
     */
    async getSingleInfo(id) {
        // Use the main getInfo method to leverage caching.
        const results = await this.getInfo([id]);
        return results.get(id) || null;
    }

    /**
     * Gets an already-cached info object without fetching.
     * @param {string} id The image ID.
     * @returns {object | undefined} The cached details or undefined.
     */
    peek(id) {
        return this.cache.get(id);
    }
}