/**
 * SnipPDF - Image Crop & Edit Module
 * Uses Cropper.js for image editing
 */

const CropModule = {
  cropper: null,
  currentImgId: null,
  currentImgUrl: '',
  visible: false,
  aspectRatio: NaN,

  /**
   * Initialize the crop module
   * @param {Object} callbacks - { onSave, onClose }
   */
  init(callbacks) {
    this.callbacks = callbacks;
  },

  /**
   * Open crop dialog for an image
   */
  open(imgId, imgUrl, currentRot) {
    this.currentImgId = imgId;
    this.currentImgUrl = imgUrl;
    this.visible = true;
    this.aspectRatio = NaN;

    // Wait for Vue reactivity to render modal
    setTimeout(() => {
      const imgEl = document.getElementById('crop-target-img');
      if (!imgEl) return;

      // Destroy existing cropper
      if (this.cropper) {
        this.cropper.destroy();
        this.cropper = null;
      }

      // Init Cropper
      if (typeof Cropper !== 'undefined') {
        this.cropper = new Cropper(imgEl, {
          viewMode: 1,
          dragMode: 'move',
          autoCropArea: 0.9,
          restore: false,
          guides: true,
          center: true,
          highlight: false,
          cropBoxMovable: true,
          cropBoxResizable: true,
          toggleDragModeOnDblclick: false,
          background: false,
          rotatable: true,
          scalable: true,
          zoomable: true,
          zoomOnWheel: true,
          wheelZoomRatio: 0.05,
          ready: () => {
            // Apply existing rotation if any
            if (currentRot && currentRot !== 0) {
              this.cropper.rotateTo(currentRot);
            }
          }
        });
      }
    }, 100);
  },

  /**
   * Set crop aspect ratio
   */
  setRatio(ratio) {
    this.aspectRatio = ratio;
    if (this.cropper) {
      if (isNaN(ratio) || ratio <= 0) {
        this.cropper.setAspectRatio(NaN);
      } else {
        this.cropper.setAspectRatio(ratio);
      }
    }
  },

  /**
   * Rotate by degrees (relative)
   */
  rotate(deg) {
    if (this.cropper) {
      this.cropper.rotate(deg);
    }
  },

  /**
   * Zoom by ratio
   */
  zoom(ratio) {
    if (this.cropper) {
      this.cropper.zoom(ratio);
    }
  },

  /**
   * Reset crop
   */
  reset() {
    if (this.cropper) {
      this.cropper.reset();
    }
  },

  /**
   * Save cropped image, returns data URL
   */
  save() {
    if (!this.cropper) return null;
    const canvas = this.cropper.getCroppedCanvas({
      maxWidth: 3000,
      maxHeight: 3000,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high'
    });
    if (!canvas) return null;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    return dataUrl;
  },

  /**
   * Close dialog without saving
   */
  close() {
    if (this.cropper) {
      this.cropper.destroy();
      this.cropper = null;
    }
    this.visible = false;
    this.currentImgId = null;
    this.currentImgUrl = '';
    if (this.callbacks && this.callbacks.onClose) {
      this.callbacks.onClose();
    }
  },

  /**
   * Confirm save
   */
  confirmSave() {
    const dataUrl = this.save();
    if (dataUrl && this.callbacks && this.callbacks.onSave) {
      this.callbacks.onSave(this.currentImgId, dataUrl);
    }
    this.close();
  }
};

// Expose to window for lazy loading
window.CropModule = CropModule;
