/**
 * SnipPDF - PDF Generation Module
 * Handles image processing and PDF export with progress tracking
 */

const PDFModule = {
  /**
   * Process a single image for PDF
   * @returns Promise<string> data URL of processed JPEG
   */
  procImg(img, quality) {
    return new Promise((resolve, reject) => {
      const c = document.createElement('canvas');
      const ctx = c.getContext('2d');
      const im = new Image();
      im.onload = () => {
        const rot = img.rot % 360;
        const swap = rot === 90 || rot === 270;
        let cw = swap ? im.height : im.width;
        let ch = swap ? im.width : im.height;
        const maxD = 2000;
        const scale = cw > maxD || ch > maxD ? maxD / Math.max(cw, ch) : 1;
        cw = Math.round(cw * scale);
        ch = Math.round(ch * scale);
        c.width = cw;
        c.height = ch;
        ctx.fillStyle = '#FFF';
        ctx.fillRect(0, 0, cw, ch);
        ctx.save();
        ctx.translate(cw / 2, ch / 2);
        if (rot === 90) ctx.rotate(Math.PI / 2);
        else if (rot === 180) ctx.rotate(Math.PI);
        else if (rot === 270) ctx.rotate(-Math.PI / 2);
        const dw2 = swap ? im.height * scale : im.width * scale;
        const dh2 = swap ? im.width * scale : im.height * scale;
        ctx.drawImage(im, -dw2 / 2, -dh2 / 2, dw2, dh2);
        ctx.restore();
        resolve(c.toDataURL('image/jpeg', quality));
      };
      im.onerror = () => reject(new Error('Image load failed'));
      im.src = img.url;
    });
  },

  /**
   * Process images in parallel with concurrency limit
   * @returns Promise<Array<{index, dataUrl}>>
   */
  async processBatch(images, quality, onProgress) {
    const CONCURRENCY = 3;
    const results = new Array(images.length);
    let completed = 0;

    const worker = async (startIdx) => {
      for (let i = startIdx; i < images.length; i += CONCURRENCY) {
        try {
          const du = await this.procImg(images[i], quality);
          results[i] = du;
        } catch (e) {
          console.error('Image processing error:', e);
          // Fallback: try to use original URL directly
          results[i] = images[i].url;
        }
        completed++;
        if (onProgress) {
          onProgress(Math.round((completed / images.length) * 100));
        }
      }
    };

    // Start concurrent workers
    const workers = [];
    for (let w = 0; w < Math.min(CONCURRENCY, images.length); w++) {
      workers.push(worker(w));
    }
    await Promise.all(workers);
    return results;
  },

  /**
   * Generate and download PDF
   */
  async exportPdf(images, compression, orientation, perPage, marginMm, onProgress) {
    const qMap = { '20': 0.35, '50': 0.65, '100': 0.92 };
    const quality = qMap[compression] || 0.65;

    // Step 1: Process all images in parallel
    onProgress('processing', 0, '正在处理图片…');
    const processedUrls = await this.processBatch(images, quality, (pct) => {
      onProgress('processing', pct, `正在处理图片 ${pct}%`);
    });

    // Step 2: Build PDF
    onProgress('building', 0, '正在生成 PDF…');

    const { jsPDF } = window.jspdf;
    const port = orientation === 'portrait';
    const pw = port ? 210 : 297;
    const ph = port ? 297 : 210;
    const doc = new jsPDF({
      orientation: orientation,
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    const per = perPage;
    const list = images;

    for (let i = 0; i < list.length; i += per) {
      if (i > 0) doc.addPage();
      const page = list.slice(i, i + per);
      let cols, rows;
      if (per === 1) { cols = 1; rows = 1; }
      else if (per === 2) { cols = 2; rows = 1; }
      else { cols = 2; rows = 2; }

      const mg = marginMm || 15;
      const uw = pw - mg * 2;
      const uh = ph - mg * 2;
      const cw = uw / cols;
      const ch = uh / rows;

      for (let j = 0; j < page.length; j++) {
        const du = processedUrls[i + j];
        if (!du) continue;
        const col = j % cols;
        const row = Math.floor(j / cols);
        const x = mg + col * cw;
        const y = mg + row * ch;

        const ip = doc.getImageProperties(du);
        const ir = ip.width / ip.height;
        const cr = cw / ch;
        let dw, dh;
        if (ir > cr) { dw = cw - 4; dh = (cw - 4) / ir; }
        else { dh = ch - 4; dw = (ch - 4) * ir; }

        doc.addImage(du, 'JPEG', x + (cw - dw) / 2, y + (ch - dh) / 2, dw, dh);
      }

      const pageProgress = Math.round(((i + per) / list.length) * 100);
      onProgress('building', Math.min(pageProgress, 100),
        `正在生成 PDF ${Math.min(pageProgress, 100)}%`);
    }

    onProgress('done', 100, '导出完成！');
    return doc;
  }
};

// Expose to window for lazy loading
window.PDFModule = PDFModule;
