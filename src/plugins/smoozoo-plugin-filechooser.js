export class FileChooserPlugin
{
    static toString() { return "SmoozooCollection"; }
    static path = "./plugins/smoozoo-plugin-filechooser.js";

    /**
     * @param {object} viewerApi The API exposed by the Smoozoo viewer.
     * @param {object} options Plugin-specific options, including a list of preset files.
     */
    constructor(viewerApi, options, containerElement)
    {
        this.containerElement = containerElement;
        this.api = viewerApi;
        this.options = {
            presetFiles: [], // Expects an array of { name: 'Display Name', url: 'path/to/image.jpg' }
            allowFileDrop: true,
            showFileList: true,
            showFileDialog: true,
            strings: {
                "Select..." : "Select...",
                "Open..." : "Open..."
            },
            ...options
        };

        this._createDOM();
        this._attachEventListeners();
    }

    /**
     * Creates all the necessary UI elements for the file chooser.
     * @private
     */
    _createDOM()
    {
        if(this.options.showFileList || this.options.showFileDialog) {
            // Main container for all UI elements
            this.container = document.createElement('div');
            this.container.className = 'file-chooser-container';
        }

        if(this.options.showFileDialog) {
            // Custom File Dialog Button
            this.fileInput = document.createElement('input');
            this.fileInput.type = 'file';
            this.fileInput.accept = 'image/*';
            this.fileInput.style.display = 'none';

            this.uploadButton = document.createElement('button');
            this.uploadButton.className = 'file-chooser-button';
            // this.uploadButton.textContent = 'Open...';
            this.uploadButton.innerHTML = this.options.strings['Open...'];;
            
            this.container.appendChild(this.uploadButton);
            this.container.appendChild(this.fileInput);

            // --- Drag and Drop Overlay ---
            this.dragOverlay = document.createElement('div');
            this.dragOverlay.className = 'file-chooser-drag-overlay';
            this.dragOverlay.innerHTML = 
                `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>` +
                `<span>Drop Image to Load</span>`;
        }

        // Preset Files Dropdown
        if (this.options.showFileList && this.options.presetFiles && this.options.presetFiles.length > 0) {
            this.select = document.createElement('select');
            this.select.className = 'file-chooser-select';

            const defaultOption = document.createElement('option');
            defaultOption.textContent = this.options.strings['Select...'];
            defaultOption.disabled = true;
            defaultOption.selected = true;
            this.select.appendChild(defaultOption);

            this.options.presetFiles.forEach(file => {
                const option = document.createElement('option');
                option.value = file.url;
                option.textContent = file.name;
                this.select.appendChild(option);
            });
            this.container.appendChild(this.select);
        }

        if(this.options.showFileList || this.options.showFileDialog) {
            this.containerElement.appendChild(this.container);
        }

        if(this.options.allowFileDrop) {
            this.containerElement.appendChild(this.dragOverlay);
        }
    }

    /**
     * Attaches all necessary DOM event listeners.
     * @private
     */
    _attachEventListeners()
    {
        if(this.options.showFileList) {
            // Preset dropdown
            this.select?.addEventListener('change', () => {
                if (this.select.value) {
                    this.api.loadImage(this.select.value, { preserveState: true });
                    this.select.selectedIndex = 0; // Reset dropdown
                }
            });
        }

        if(this.options.showFileDialog) {
            // Custom file button
            this.uploadButton.addEventListener('click', () => this.fileInput.click());
            this.fileInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files[0]) {
                    this._handleFile(e.target.files[0]);
                }
            });
        }

        if(this.options.allowFileDrop) {
            // Drag and Drop
            this.containerElement.addEventListener('dragover', (e) => {
                e.preventDefault();
                this.dragOverlay.classList.add('visible');
            });
            this.containerElement.addEventListener('dragleave', () => {
                this.dragOverlay.classList.remove('visible');
            });
            this.containerElement.addEventListener('drop', (e) => {
                e.preventDefault();
                this.dragOverlay.classList.remove('visible');
                if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    this._handleFile(e.dataTransfer.files[0]);
                }
            });
        }
    }

    /**
     * Validates a file and tells the viewer to load it.
     * @param {File} file The file object from the input or drop event.
     * @private
     */
    _handleFile(file)
    {
        if (!file.type.startsWith('image/')) {
            alert('Please drop an image file.');
            return;
        }
        
        const objectURL = URL.createObjectURL(file);
        this.api.loadImage(objectURL);
    }
}

if(!window?.smoozooPlugins)
    window.smoozooPlugins = {};
window.smoozooPlugins["FileChooserPlugin"] = FileChooserPlugin;
