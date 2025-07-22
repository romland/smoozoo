export class HotspotPlugin
{
    static toString() { return "HotspotPlugin"; }
    static path = "./plugins/smoozoo-plugin-hotspot.js";

    constructor(viewer, options, containerElement)
    {
        const targetElement = containerElement;
        const htmlFragment = `<div id="smoozoo-hotspot-layer"></div>`;
        targetElement.insertAdjacentHTML('beforeend', htmlFragment);

        this.viewer = viewer;
        this.hotspots = options.hotspots || [];
        this.objectType = options.objectType || "";

        this.container = document.getElementById('smoozoo-hotspot-layer');
        this.activeHotspots = [];
        this.stickyHotspots = [];
        this.mouseScreenPos = { x: 0, y: 0 };

        this.clusterRadius = 80;
        this.zoomThreshold = 0.5;
        this.markerPool = [];
        this.activeMarkers = [];
        this.popupAnchor = null;
        
        this.lastPopupPosition = { x: null, y: null };
        this.popupMoveThreshold = 1.5; // Only move popup if anchor moves more than this many pixels.

        this.handleMarkerClick = this.handleMarkerClick.bind(this);
        this.handleOutsideClick = this.handleOutsideClick.bind(this);
        this.init();
    }
	
    
    init()
    {
        this.container.innerHTML = '';
        this.popup = document.createElement('div');
        this.popup.className = 'hotspot-popup-shared';
        this.container.appendChild(this.popup);
        document.addEventListener('click', this.handleOutsideClick);
    }


    handleMarkerClick(e, data, markerElement)
    {
        e.stopPropagation();
        
        // The anchor is always the specific marker that was clicked.
        const anchor = { marker: markerElement, screenPos: data.screenPos };

        if (data.isCluster) {
            this.stickyHotspots = [...data.hotspots];
        } else {
            // If overlapping individual markers are hovered, make them all sticky.
            if (this.activeHotspots.length > 0) {
                this.stickyHotspots = [...this.activeHotspots];
            }
        }
        
        this.popupAnchor = anchor;
        this.activeHotspots = []; // Clear hover state
        this.viewer.requestRender();
    }


    handleOutsideClick(e)
    {
        if (this.stickyHotspots.length > 0 && !this.popup.contains(e.target)) {
            this.stickyHotspots = [];
            this.popupAnchor = null;
            this.viewer.requestRender();
        }
    }


    worldToScreen(worldX, worldY)
    {
        const { scale, originX, originY } = this.viewer.getTransform();
        return { x: (worldX + originX) * scale, y: (worldY + originY) * scale };
    }


    onMouseMove(e)
    {
        if (this.stickyHotspots.length > 0) {
            if (this.activeHotspots.length > 0) {
                this.activeHotspots = [];
                this.viewer.requestRender();
            }

            return;
        }
        
        const isHoverPopupVisible = this.activeHotspots.length > 0 && this.popup.style.display === 'block';
        if (isHoverPopupVisible && this.popup.contains(e.target)) {
            return;
        }

        const previousHotspots = [...this.activeHotspots];
        const canvasRect = this.viewer.getCanvas().getBoundingClientRect();
        this.mouseScreenPos = { x: e.clientX, y: e.clientY };

        if (e.clientX >= canvasRect.left && e.clientX <= canvasRect.right &&
            e.clientY >= canvasRect.top && e.clientY <= canvasRect.bottom) {
            this.checkForHover();
        } else {
            this.activeHotspots = [];
            this.popupAnchor = null;
        }

        if (this.activeHotspots.length !== previousHotspots.length ||
            !this.activeHotspots.every((h, i) => h.id === previousHotspots[i]?.id)) {
            this.viewer.requestRender();
        }
    }
    

    checkForHover()
    {
        let foundHotspots = [];
        let hoveredClusterData = null;
    
        for (const markerData of this.activeMarkers) {
            const markerRadius = markerData.marker.offsetWidth / 2;
            const distance = Math.sqrt(
                Math.pow(this.mouseScreenPos.x - markerData.screenPos.x, 2) +
                Math.pow(this.mouseScreenPos.y - markerData.screenPos.y, 2)
            );
    
            if (distance <= markerRadius) {
                if (markerData.isCluster) {
                    hoveredClusterData = markerData;
                    break; 
                } else {
                    foundHotspots.push(markerData.hotspot);
                }
            }
        }
        
        if (hoveredClusterData) {
            this.activeHotspots = hoveredClusterData.hotspots;
            this.popupAnchor = { marker: hoveredClusterData.marker, screenPos: hoveredClusterData.screenPos };
        } else {
            this.activeHotspots = foundHotspots;
            if (foundHotspots.length > 0) {
                const firstActiveId = foundHotspots[0].id;
                const markerData = this.activeMarkers.find(m => !m.isCluster && m.hotspot.id === firstActiveId);
                if (markerData) {
                    this.popupAnchor = { marker: markerData.marker, screenPos: markerData.screenPos };
                } else {
                    this.popupAnchor = null;
                }
            } else {
                this.popupAnchor = null;
            }
        }
    }

    
    getMarkerFromPool()
    {
        if (this.markerPool.length > 0) {
            const marker = this.markerPool.pop();
            marker.style.display = 'block';
            return marker;
        }
        const marker = document.createElement('div');
        this.container.appendChild(marker);
        return marker;
    }

    
    releaseMarkerToPool(marker)
    {
        marker.style.display = 'none';
        marker.className = '';
        marker.onclick = null;
        this.markerPool.push(marker);
    }

    
    update()
    {
        const canvas = this.viewer.getCanvas();
        const transform = this.viewer.getTransform();
        const canvasBounds = { left: 0, top: 0, right: canvas.width, bottom: canvas.height };

        this.activeMarkers.forEach(({ marker }) => this.releaseMarkerToPool(marker));
        this.activeMarkers = [];

        const visibleHotspots = this.hotspots.map(hotspot => ({
            hotspot,
            screenPos: this.worldToScreen(hotspot.x, hotspot.y)
        })).filter(({ screenPos }) =>
            screenPos.x >= canvasBounds.left && screenPos.x <= canvasBounds.right &&
            screenPos.y >= canvasBounds.top && screenPos.y <= canvasBounds.bottom
        );

        if (transform.scale < this.zoomThreshold) {
            const clusters = [];
            let visited = new Set();
            for (const { hotspot, screenPos } of visibleHotspots) {
                if (visited.has(hotspot.id)) continue;
                const neighbors = visibleHotspots.filter(other => {
                    const dist = Math.sqrt(Math.pow(screenPos.x - other.screenPos.x, 2) + Math.pow(screenPos.y - other.screenPos.y, 2));
                    return dist < this.clusterRadius;
                });

                if (neighbors.length > 1) {
                    let totalX = 0, totalY = 0;
                    neighbors.forEach(n => {
                        totalX += n.screenPos.x;
                        totalY += n.screenPos.y;
                        visited.add(n.hotspot.id);
                    });
                    const center = { x: totalX / neighbors.length, y: totalY / neighbors.length };
                    
                    clusters.push({
                        isCluster: true,
                        count: neighbors.length,
                        hotspots: neighbors.map(n => n.hotspot),
                        center: center,
                        screenPos: center
                    });
                } else {
                    clusters.push({ ...hotspot, screenPos });
                    visited.add(hotspot.id);
                }
            }
            this.renderMarkers(clusters);
        } else {
            this.renderMarkers(visibleHotspots.map(h => ({ ...h.hotspot, screenPos: h.screenPos })));
        }
        this.updatePopup();
    }


    renderMarkers(items)
    {
        items.forEach(item => {
            const marker = this.getMarkerFromPool();
            marker.style.left = `${item.screenPos.x}px`;
            marker.style.top = `${item.screenPos.y}px`;
            
            let markerData;
            if (item.isCluster) {
                marker.className = 'hotspot-cluster-marker';
                marker.innerHTML = "<br/>" + item.count + "<br/><small>" + this.objectType + "</small>";
                const diameter = 30 + Math.log2(item.count) * 5;
                marker.style.width = `${diameter}px`;
                marker.style.height = `${diameter}px`;
                marker.style.lineHeight = `${diameter/4}px`;    // /4 because we use several lines -- if one line, just diameter

                markerData = { ...item, marker };
            } else {
                marker.className = 'hotspot-marker';
                marker.innerText = '';
                const diameter = Math.max(5, item.radius * 2 * this.viewer.getTransform().scale);
                marker.style.width = `${diameter}px`;
                marker.style.height = `${diameter}px`;
                markerData = { hotspot: item, marker, screenPos: item.screenPos };
            }
            
            marker.onclick = (e) => this.handleMarkerClick(e, item, marker);
            this.activeMarkers.push(markerData);
        });
    }
	
    
    updatePopup()
    {
        const hotspotsToShow = this.stickyHotspots.length > 0 ? this.stickyHotspots : this.activeHotspots;

        if (hotspotsToShow.length > 0 && this.popupAnchor) {
            this.popup.style.display = 'block'; // Ensure popup is visible to measure it
            
            let contentHTML = '';
            hotspotsToShow.forEach((hotspot, index) => {
                if (hotspot.content.title) contentHTML += `<h3>${hotspot.content.title}</h3>`;
                if (hotspot.content.text) contentHTML += `<p>${hotspot.content.text}</p>`;
                if (hotspot.content.image) contentHTML += `<img src="${hotspot.content.image}" alt="${hotspot.content.title || 'Hotspot Image'}">`;
                if (hotspot.content.subtitle) contentHTML += `<p class="hotspot-footer">${hotspot.content.subtitle}</p>`;
                if (index < hotspotsToShow.length - 1) {
                    contentHTML += '<hr class="hotspot-separator">';
                }
            });

            this.popup.innerHTML = contentHTML;
            this.popup.classList.toggle('is-sticky', this.stickyHotspots.length > 0);

            // --- Positioning and Smoothing Logic ---
            const marker = this.popupAnchor.marker;
            const screenPos = this.popupAnchor.screenPos;
            const markerRect = {
                top: screenPos.y - marker.offsetHeight / 2, left: screenPos.x - marker.offsetWidth / 2,
                width: marker.offsetWidth, height: marker.offsetHeight,
                bottom: screenPos.y + marker.offsetHeight / 2, right: screenPos.x + marker.offsetWidth / 2,
            };

            // Measure the popup itself once
            const popupRect = this.popup.getBoundingClientRect();
            const margin = 15;

            // Find best placement
            const placements = {
                above: { top: markerRect.top - popupRect.height - margin, left: markerRect.left + markerRect.width / 2 - popupRect.width / 2 },
                below: { top: markerRect.bottom + margin, left: markerRect.left + markerRect.width / 2 - popupRect.width / 2 },
                right: { top: markerRect.top + markerRect.height / 2 - popupRect.height / 2, left: markerRect.right + margin },
                left: { top: markerRect.top + markerRect.height / 2 - popupRect.height / 2, left: markerRect.left - popupRect.width - margin }
            };

            let bestPlacement = null;
            for (const key of ['above', 'below', 'right', 'left']) {
                const p = placements[key];
                if (p.top > margin && p.left > margin && (p.top + popupRect.height) < window.innerHeight - margin && (p.left + popupRect.width) < window.innerWidth - margin) {
                    bestPlacement = p;
                    break;
                }
            }
            const finalPlacement = bestPlacement || placements.left;

            // Calculate distance from the last rendered position
            const dist = Math.hypot(finalPlacement.left - this.lastPopupPosition.x, finalPlacement.top - this.lastPopupPosition.y);

            // If we have a previous position and the new one is too close, do nothing.
            if (this.lastPopupPosition.x !== null && dist < this.popupMoveThreshold) {
                return;
            }
            
            // Otherwise, update the position with a smooth CSS transform.
            this.popup.style.transform = `translate(${finalPlacement.left}px, ${finalPlacement.top}px)`;
            this.lastPopupPosition = { x: finalPlacement.left, y: finalPlacement.top };

        } else {
            this.popup.style.display = 'none';
            this.lastPopupPosition = { x: null, y: null }; // Reset when hidden
        }
    }

    
    destroy()
    {
        document.removeEventListener('click', this.handleOutsideClick);
        this.container.innerHTML = '';
    }
}

if(!window?.smoozooPlugins)
    window.smoozooPlugins = {};
window.smoozooPlugins["HotspotPlugin"] = HotspotPlugin;