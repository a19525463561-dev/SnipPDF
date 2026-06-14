/**
 * SnipPDF - Main Application Logic
 * Vue 3 (轻量，无重型UI库依赖)
 * 按需懒加载: jsPDF / CropperJS / SortableJS
 */

const { createApp, ref, computed, watch, nextTick, onMounted, onBeforeUnmount } = Vue;

// ── 全局 Toast 系统（替代 TDesign MessagePlugin） ──
let toastId = 0;
function showToast(message, type, duration) {
  type = type || 'info';
  duration = duration || 2500;
  if (!window.__toastQueue) window.__toastQueue = ref([]);
  const id = ++toastId;
  window.__toastQueue.value.push({ id: id, message: message, type: type });
  setTimeout(function() {
    var q = window.__toastQueue.value;
    var idx = q.findIndex(function(t) { return t.id === id; });
    if (idx !== -1) q.splice(idx, 1);
  }, duration);
}

// ── 动态加载脚本/CSS ──
function loadScript(src) {
  return new Promise(function(resolve, reject) {
    if (document.querySelector('script[src="' + src + '"]')) { resolve(); return; }
    var s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}
function loadCSS(href) {
  return new Promise(function(resolve) {
    if (document.querySelector('link[href="' + href + '"]')) { resolve(); return; }
    var l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href;
    l.onload = resolve;
    document.head.appendChild(l);
  });
}

const app = createApp({
  setup() {
    // ── State ──
    const images = ref([]);
    const compression = ref('50');
    const orientation = ref('portrait');
    const perPage = ref(1);
    const pageMargin = ref('standard');
    const fileName = ref('');
    const exporting = ref(false);
    const dragOver = ref(false);
    const trashOver = ref(false);
    const fnErr = ref(false);
    const fnErrMsg = ref('');
    const showUndo = ref(false);
    const undoMsg = ref('');
    const deletedStack = ref([]);
    const fileInp = ref(null);
    const fileInpEditor = ref(null);
    const previewRoot = ref(null);
    const trashWrap = ref(null);
    const trashDrop = ref(null);
    const idCnt = ref(0);

    // Toast queue
    var _tq = ref([]);
    window.__toastQueue = _tq;

    // ── Margin presets ──
    var marginPresets = { compact: 5, standard: 15, loose: 25 };

    // ── Lazy-loaded module references ──
    var PDFModule = null;
    var CropModule = null;

    // ── LocalStorage settings ──
    var SETTINGS_KEY = 'snappdf_settings';
    function loadSettings() {
      try {
        var raw = localStorage.getItem(SETTINGS_KEY);
        if (raw) {
          var s = JSON.parse(raw);
          if (s.compression && ['20','50','100'].includes(s.compression)) compression.value = s.compression;
          if (s.orientation && ['portrait','landscape'].includes(s.orientation)) orientation.value = s.orientation;
          if (s.perPage && [1,2,4].includes(s.perPage)) perPage.value = s.perPage;
          if (s.pageMargin && ['compact','standard','loose'].includes(s.pageMargin)) pageMargin.value = s.pageMargin;
        }
      } catch (e) { /* ignore */ }
    }
    function saveSettings() {
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({
          compression: compression.value,
          orientation: orientation.value,
          perPage: perPage.value,
          pageMargin: pageMargin.value
        }));
      } catch (e) { /* ignore */ }
    }

    // Export progress
    var exportProgress = ref(0);
    var exportProgressText = ref('');
    var showExportProgress = ref(false);

    // Crop dialog state
    var cropVisible = ref(false);
    var cropSrc = ref('');
    var cropImgId = ref(null);
    var cropActiveRatio = ref('free');
    var cropRot = ref(0);

    // PWA install
    var pwaInstallVisible = ref(false);
    var pwaDeferredPrompt = null;

    // Lazy load tracking
    var _pdfLoading = null;
    var _cropJsLoaded = false;
    var _sortableLoaded = false;

    // ── Computed ──
    var hasImg = computed(function() { return images.value.length > 0; });

    var pages = computed(function() {
      var pp = perPage.value;
      var pgs = [];
      for (var i = 0; i < images.value.length; i += pp) {
        pgs.push(images.value.slice(i, i + pp));
      }
      return pgs;
    });

    var pageStyle = computed(function() {
      var port = orientation.value === 'portrait';
      var maxW = 520;
      var w = port ? maxW : maxW * 1.414;
      var h = port ? maxW * 1.414 : maxW;
      return { width: w + 'px', height: h + 'px' };
    });

    var marginBoxStyle = computed(function() {
      var maxW = 520;
      var pxPerMm = maxW / 210;
      var mgMm = marginPresets[pageMargin.value] || 15;
      var mgPx = Math.round(mgMm * pxPerMm);
      return {
        top: mgPx + 'px',
        right: mgPx + 'px',
        bottom: mgPx + 'px',
        left: mgPx + 'px'
      };
    });

    var imageGridPadding = computed(function() {
      var maxW = 520;
      var pxPerMm = maxW / 210;
      var mgMm = marginPresets[pageMargin.value] || 15;
      var mgPx = Math.round(mgMm * pxPerMm);
      return { padding: mgPx + 'px' };
    });

    var estimatedSize = computed(function() {
      if (typeof estimatePdfSize === 'function') {
        return estimatePdfSize(images.value, compression.value, perPage.value);
      }
      return 0;
    });

    var estimatedSizeText = computed(function() {
      if (!hasImg.value) return '';
      if (typeof formatSize === 'function') return formatSize(estimatedSize.value);
      return Math.round(estimatedSize.value / 1024) + 'KB';
    });

    var undoTo = null;
    var sortables = [];
    var trashDeletePending = false;

    // ── Lazy Loader: jsPDF ──
    function ensurePdfModule() {
      if (PDFModule) return Promise.resolve(PDFModule);
      if (_pdfLoading) return _pdfLoading;
      _pdfLoading = Promise.all([
        loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'),
        loadScript('./js/pdf.js')
      ]).then(function() {
        PDFModule = window.PDFModule;
        return PDFModule;
      });
      return _pdfLoading;
    }

    // ── Lazy Loader: CropperJS ──
    function ensureCropper() {
      if (_cropJsLoaded && typeof Cropper !== 'undefined') return Promise.resolve();
      return Promise.all([
        loadScript('https://cdn.jsdelivr.net/npm/cropperjs@1.6.2/dist/cropper.min.js'),
        loadCSS('https://cdn.jsdelivr.net/npm/cropperjs@1.6.2/dist/cropper.min.css'),
        loadScript('./js/crop.js')
      ]).then(function() {
        CropModule = window.CropModule || { cropper: null };
        _cropJsLoaded = true;
      });
    }

    // ── Lazy Loader: SortableJS ──
    function ensureSortable() {
      if (_sortableLoaded && typeof Sortable !== 'undefined') return Promise.resolve();
      return loadScript('https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.min.js').then(function() {
        _sortableLoaded = true;
      });
    }

    // ── File Input ──
    function openFile() {
      if (exporting.value) return;
      var inp = fileInp.value || fileInpEditor.value;
      if (inp) inp.click();
    }

    function onDrop(e) {
      dragOver.value = false;
      if (exporting.value) return;
      processFiles(Array.from(e.dataTransfer.files));
    }

    function onFiles(e) {
      processFiles(Array.from(e.target.files));
      e.target.value = '';
    }

    // ── Paste from Clipboard ──
    function onPaste(e) {
      if (exporting.value) return;
      var items = e.clipboardData?.items;
      if (!items) return;
      var files = [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.startsWith('image/')) {
          var f = items[i].getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        processFiles(files);
        showToast('已粘贴 ' + files.length + ' 张图片', 'success');
      }
    }

    // ── Image Processing ──
    function processFiles(files) {
      if (!files.length) return;
      var valid = [];
      var badCount = 0;
      var heicCount = 0;

      files.forEach(function(f) {
        if (isSupportedType(f.type)) {
          valid.push(f);
          if (isHeicType(f.type)) heicCount++;
        } else {
          badCount++;
        }
      });

      if (badCount > 0 && valid.length === 0) {
        showToast('仅支持 JPG、PNG、WebP、BMP、HEIC 格式图片', 'warning');
        return;
      }

      if (heicCount > 0) {
        showToast('HEIC 格式需要 Safari 浏览器支持', 'info', 4000);
      }

      if (!valid.length) return;

      var loaded = 0;
      valid.forEach(function(f) {
        var r = new FileReader();
        r.onload = function(ev) {
          var img = new Image();
          img.onload = function() {
            images.value.push({
              id: idCnt.value++,
              url: ev.target.result,
              rot: 0,
              name: f.name,
              origIdx: images.value.length,
              w: img.width,
              h: img.height
            });
            loaded++;
            if (loaded === valid.length) {
              reIdx();
              nextTick(function() { initSort(); });
            }
          };
          img.onerror = function() {
            loaded++;
            if (loaded === valid.length) {
              reIdx();
              nextTick(function() { initSort(); });
            }
          };
          img.src = ev.target.result;
        };
        r.onerror = function() {
          loaded++;
          if (loaded === valid.length) {
            reIdx();
            nextTick(function() { initSort(); });
          }
        };
        r.readAsDataURL(f);
      });
    }

    function reIdx() {
      images.value.forEach(function(m, i) { m.origIdx = i; });
    }

    function delImg(id) {
      var el = document.querySelector('.image-card[data-id="' + id + '"]');
      removeImg(id, el);
    }

    function removeImg(id, el) {
      if (el) { el.classList.add('removing'); el.style.pointerEvents = 'none'; }
      setTimeout(function() {
        var idx = images.value.findIndex(function(m) { return m.id === id; });
        if (idx === -1) return;
        var d = images.value.splice(idx, 1)[0];
        deletedStack.value.push({ imgs: [d], origIdx: idx });
        reIdx();
        showUndoMsg('已删除 1 张图片');
        if (el && el.parentNode) el.remove();
        nextTick(function() { initSort(); });
      }, 300);
    }

    function rotImg(id, deg) {
      var m = images.value.find(function(m) { return m.id === id; });
      if (m) m.rot = (m.rot + deg + 360) % 360;
    }

    function reverseAll() {
      if (!hasImg.value || exporting.value) return;
      images.value.reverse();
      reIdx();
      nextTick(function() { initSort(); });
    }

    // 确认清空（替代 t-popconfirm）
    function confirmClearAll() {
      if (!hasImg.value || exporting.value) return;
      if (confirm('确定清空所有图片？此操作可撤销')) {
        clearAll();
      }
    }

    function clearAll() {
      if (!hasImg.value || exporting.value) return;
      var cnt = images.value.length;
      deletedStack.value.push({ imgs: [...images.value], clearAll: true });
      images.value = [];
      showUndoMsg('已清空 ' + cnt + ' 张图片');
      nextTick(function() { initSort(); });
    }

    function onTrashDrop() {
      trashOver.value = false;
      var el = document.querySelector('.sortable-drag');
      if (el) {
        var id = parseInt(el.dataset.id);
        if (!isNaN(id)) delImg(id);
      }
    }

    function showUndoMsg(msg) {
      showUndo.value = true;
      undoMsg.value = msg;
      if (undoTo) clearTimeout(undoTo);
      undoTo = setTimeout(function() {
        showUndo.value = false;
        deletedStack.value = [];
      }, 5000);
    }

    function doUndo() {
      if (!deletedStack.value.length) return;
      var e = deletedStack.value.pop();
      if (!e || !e.imgs) return;
      if (e.clearAll) {
        images.value = [...e.imgs];
      } else {
        var m = e.imgs[0];
        var idx = Math.min(e.origIdx, images.value.length);
        images.value.splice(idx, 0, m);
      }
      reIdx();
      if (undoTo) clearTimeout(undoTo);
      showUndo.value = false;
      nextTick(function() { initSort(); });
    }

    function chkFn() {
      if (typeof validateFilename === 'function') {
        var result = validateFilename(fileName.value);
        fnErr.value = !result.valid;
        fnErrMsg.value = result.msg;
      }
    }

    // ── 平板端触控修复：区分按钮点击与卡片点击 ──
    // 平板触控环境下，.card-btn 的 z-index 层会拦截触摸事件，
    // 导致 openCrop 无法通过 click 触发。此方法通过 touchend 兜底处理。
    var _cardTouchMoved = false;
    var _cardTouchTimer = null;

    function onCardTouchEnd(e, imgId) {
      // 如果触点在操作按钮上，交给按钮自己的 click 处理
      if (e.target.closest('.card-btn')) return;
      // 如果发生了拖拽（Sortable），不触发裁剪
      if (_cardTouchMoved) {
        _cardTouchMoved = false;
        return;
      }
      // 短暂延迟，避免与 click 事件冲突（click 可能在 touchend 之后也触发）
      if (_cardTouchTimer) clearTimeout(_cardTouchTimer);
      _cardTouchTimer = setTimeout(function() {
        _cardTouchTimer = null;
        openCrop(imgId);
      }, 50);
    }

    // ── Crop Dialog ──
    function openCrop(imgId) {
      if (exporting.value) return;
      var img = images.value.find(function(m) { return m.id === imgId; });
      if (!img) return;

      ensureCropper().then(function() {
        cropImgId.value = imgId;
        cropSrc.value = img.url;
        cropRot.value = img.rot || 0;
        cropActiveRatio.value = 'free';
        cropVisible.value = true;

        nextTick(function() {
          var imgEl = document.getElementById('crop-target-img');
          if (!imgEl) return;

          if (CropModule.cropper) {
            try { CropModule.cropper.destroy(); } catch(ex) {}
            CropModule.cropper = null;
          }

          if (typeof Cropper !== 'undefined') {
            CropModule.cropper = new Cropper(imgEl, {
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
              ready: function() {
                if (cropRot.value && cropRot.value !== 0) {
                  CropModule.cropper.rotateTo(cropRot.value);
                }
              }
            });
          }
        });
      });
    }

    function closeCrop() {
      if (CropModule && CropModule.cropper) {
        try { CropModule.cropper.destroy(); } catch(ex) {}
        CropModule.cropper = null;
      }
      cropVisible.value = false;
      cropImgId.value = null;
      cropSrc.value = '';
    }

    function setCropRatio(ratioName, ratioValue) {
      cropActiveRatio.value = ratioName;
      if (CropModule && CropModule.cropper) {
        if (isNaN(ratioValue) || ratioValue <= 0) {
          CropModule.cropper.setAspectRatio(NaN);
        } else {
          CropModule.cropper.setAspectRatio(ratioValue);
        }
      }
    }

    function rotateCrop(deg) {
      if (CropModule && CropModule.cropper) {
        CropModule.cropper.rotate(deg);
      }
    }

    function resetCrop() {
      if (CropModule && CropModule.cropper) {
        CropModule.cropper.reset();
      }
    }

    function saveCrop() {
      if (!CropModule || !CropModule.cropper || cropImgId.value === null) return;

      var canvas = CropModule.cropper.getCroppedCanvas({
        maxWidth: 3000,
        maxHeight: 3000,
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high'
      });

      if (!canvas) {
        showToast('裁剪失败，请重试', 'warning');
        return;
      }

      var dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      var img = images.value.find(function(m) { return m.id === cropImgId.value; });
      if (img) {
        img.url = dataUrl;
        img.w = canvas.width;
        img.h = canvas.height;
        img.rot = 0;
      }

      showToast('图片编辑已保存', 'success');
      closeCrop();
    }

    function onCropZoom(e) {
      if (!CropModule || !CropModule.cropper) return;
      var ratio = parseFloat(e.target.value) / 50;
      CropModule.cropper.zoomTo(ratio);
    }

    // ── Sortable ──
    function initSort() {
      sortables.forEach(function(s) { try { s.destroy(); } catch(e) {} });
      sortables = [];
      if (!hasImg.value) return;
      ensureSortable().then(function() {
        nextTick(function() {
          var wrap = trashWrap.value;
          var containers = document.querySelectorAll('.page-images');
          containers.forEach(function(c) {
            var s = new Sortable(c, {
              group: { name: 'imgs', pull: true, put: true },
              animation: 180,
              easing: 'cubic-bezier(0.4,0,0.2,1)',
              ghostClass: 'sortable-ghost',
              dragClass: 'sortable-drag',
              filter: '.card-btn',
              preventOnFilter: false,
              onMove: function(evt) {
                if (wrap) {
                  var toEl = evt.to;
                  var dropEl = trashDrop.value;
                  if (toEl === dropEl || (dropEl && dropEl.contains(toEl)) || toEl?.closest('.trash-wrap')) {
                    wrap.classList.add('drag-over');
                  } else {
                    wrap.classList.remove('drag-over');
                  }
                }
                return true;
              },
              onEnd: onSortEnd
            });
            sortables.push(s);
          });
          if (trashDrop.value) {
            var ts = new Sortable(trashDrop.value, {
              group: { name: 'imgs', pull: false, put: true },
              sort: false,
              onAdd: function(evt) {
                trashDeletePending = true;
                var id = parseInt(evt.item.dataset.id);
                if (!isNaN(id)) {
                  var idx = images.value.findIndex(function(m) { return m.id === id; });
                  if (idx !== -1) {
                    var d = images.value.splice(idx, 1)[0];
                    deletedStack.value.push({ imgs: [d], origIdx: idx });
                    reIdx();
                    showUndoMsg('已删除 1 张图片');
                  }
                  evt.item.classList.add('removing');
                  evt.item.style.pointerEvents = 'none';
                  setTimeout(function() {
                    if (evt.item.parentNode) evt.item.remove();
                    nextTick(function() { initSort(); });
                  }, 300);
                }
              }
            });
            sortables.push(ts);
          }
        });
      });
    }

    function onSortEnd() {
      if (trashWrap.value) trashWrap.value.classList.remove('drag-over');
      if (trashDeletePending) { trashDeletePending = false; return; }
      var newOrd = [];
      document.querySelectorAll('.page-images').forEach(function(c) {
        c.querySelectorAll('.image-card').forEach(function(el) {
          var id = parseInt(el.dataset.id);
          var m = images.value.find(function(m) { return m.id === id; });
          if (m) newOrd.push(m);
        });
      });
      if (newOrd.length === images.value.length) {
        images.value = newOrd;
        reIdx();
      }
      nextTick(function() { initSort(); });
    }

    // ── PDF Export ──
    async function exportPdf() {
      if (!hasImg.value || exporting.value) {
        if (!hasImg.value) showToast('请先上传图片', 'warning');
        return;
      }
      if (fnErr.value) {
        showToast('文件名包含非法字符，请修改后重试', 'warning');
        return;
      }

      exporting.value = true;
      document.body.classList.add('exporting');
      showExportProgress.value = true;
      exportProgress.value = 0;
      exportProgressText.value = '正在处理图片…';

      try {
        await ensurePdfModule();

        var doc = await PDFModule.exportPdf(
          images.value,
          compression.value,
          orientation.value,
          perPage.value,
          marginPresets[pageMargin.value] || 15,
          function(phase, pct, text) {
            exportProgress.value = pct;
            exportProgressText.value = text;
          }
        );

        var name = fileName.value.trim() || 'SnipPDF_导出';
        name = name.replace(/\.pdf$/i, '') + '.pdf';
        doc.save(name);
        showToast('PDF 导出成功！', 'success');
      } catch (e) {
        console.error(e);
        showToast('导出失败，请重试', 'error');
      } finally {
        exporting.value = false;
        document.body.classList.remove('exporting');
        showExportProgress.value = false;
      }
    }

    // ── PWA Install ──
    function installPwa() {
      if (pwaDeferredPrompt) {
        pwaDeferredPrompt.prompt();
        pwaDeferredPrompt.userChoice.then(function() {
          pwaDeferredPrompt = null;
          pwaInstallVisible.value = false;
        });
      }
    }

    function dismissPwaInstall() {
      pwaInstallVisible.value = false;
    }

    // ── Watchers ──
    watch(fileName, function(val) {
      if (typeof sanitizeFilename === 'function') {
        var clean = sanitizeFilename(val);
        if (clean !== val) {
          fileName.value = clean;
          chkFn();
        }
      }
    });

    watch([compression, orientation, perPage, pageMargin], function() {
      saveSettings();
    }, { deep: true });

    // ── Lifecycle ──
    onMounted(function() {
      loadSettings();

      // Register paste handler
      document.addEventListener('paste', onPaste);

      // PWA install handler
      window.addEventListener('beforeinstallprompt', function(e) {
        e.preventDefault();
        pwaDeferredPrompt = e;
        pwaInstallVisible.value = true;
      });

      // 平板端触控拖拽检测：防止拖拽时误触 openCrop
      document.addEventListener('touchmove', function() {
        _cardTouchMoved = true;
      }, { passive: true });
      document.addEventListener('touchend', function() {
        // 延迟重置，让 image-card 的 touchend 先判断
        setTimeout(function() { _cardTouchMoved = false; }, 100);
      });
    });

    onBeforeUnmount(function() {
      sortables.forEach(function(s) { s.destroy(); });
      if (undoTo) clearTimeout(undoTo);
      document.removeEventListener('paste', onPaste);
    });

    return {
      // State
      images: images, compression: compression, orientation: orientation,
      perPage: perPage, pageMargin: pageMargin, fileName: fileName,
      exporting: exporting, dragOver: dragOver, trashOver: trashOver,
      fnErr: fnErr, fnErrMsg: fnErrMsg,
      showUndo: showUndo, undoMsg: undoMsg,
      fileInp: fileInp, fileInpEditor: fileInpEditor,
      previewRoot: previewRoot, trashWrap: trashWrap, trashDrop: trashDrop,
      // Computed
      hasImg: hasImg, pages: pages, pageStyle: pageStyle,
      marginBoxStyle: marginBoxStyle, imageGridPadding: imageGridPadding,
      marginPresets: marginPresets,
      // Export progress
      exportProgress: exportProgress, exportProgressText: exportProgressText,
      showExportProgress: showExportProgress,
      // Estimates
      estimatedSize: estimatedSize, estimatedSizeText: estimatedSizeText,
      // Crop
      cropVisible: cropVisible, cropSrc: cropSrc, cropImgId: cropImgId,
      cropActiveRatio: cropActiveRatio,
      // Toast
      toasts: _tq,
      // PWA
      pwaInstallVisible: pwaInstallVisible,
      // Methods
      openFile: openFile, onDrop: onDrop, onFiles: onFiles,
      delImg: delImg, rotImg: rotImg,
      reverseAll: reverseAll, confirmClearAll: confirmClearAll,
      onTrashDrop: onTrashDrop, doUndo: doUndo, chkFn: chkFn,
      exportPdf: exportPdf,
      openCrop: openCrop, closeCrop: closeCrop,
      onCardTouchEnd: onCardTouchEnd,
      setCropRatio: setCropRatio, rotateCrop: rotateCrop,
      resetCrop: resetCrop, saveCrop: saveCrop, onCropZoom: onCropZoom,
      installPwa: installPwa, dismissPwaInstall: dismissPwaInstall
    };
  }
});
