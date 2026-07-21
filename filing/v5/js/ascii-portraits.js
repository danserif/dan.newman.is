/**
 * AsciiPortrait — vanilla JS, no dependencies.
 *
 * Usage:
 *   <div id="ascii-portraits" style="width:100%;max-width:640px;"></div>
 *   <script src="ascii-portraits.js"></script>
 *   <script>
 *     const portrait = new AsciiPortrait(document.getElementById('ascii-portraits'), {
 *       src: '/images/dan-newman.jpg',
 *       mode: 'dark' // 'dark' | 'light' | 'lime' | 'blue'
 *     });
 *     // when your site's theme changes:
 *     portrait.setMode(newTheme);
 *   </script>
 */
(function () {
  const MODE_COLORS = {
    dark: { fg: '#f2f2ef', hover: '#aaff00' },
    light: { fg: '#0a0a0a', hover: '#0044ff' },
    lime: { fg: '#0b1406', hover: '#0b1406' },
    blue: { fg: '#f2f2ef', hover: '#f2f2ef' }
  };
  const DEFAULT_RAMP =
    " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
  const GLYPH_POOL =
    '@#%*+=-:.,;\'"^~<>[]{}()/\\|abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');

  class AsciiPortrait {
    constructor(container, options = {}) {
      this.container = container;
      this.options = Object.assign(
        {
          src: '',
          mode: 'dark',
          density: 180, // grid columns (overridden by densityBreakpoints when set)
          // Matches site layout breakpoints: ≤1080 / 1081 / 1641 / 2661
          densityBreakpoints: [
            { minWidth: 2661, density: 520 },
            { minWidth: 1641, density: 440 },
            { minWidth: 1081, density: 360 },
            { minWidth: 0, density: 260 }
          ],
          characters: '', // custom ramp string; falls back to DEFAULT_RAMP
          hoverCells: 2, // base hover reach, in grid cells
          introDuration: 1400, // ms for random glyph reveal on first load
          idleBurstsPerSecond: 0.35, // ambient clustered glyph flickers
          idleCells: 1, // cluster radius (smaller than hover)
          idleSettleMin: 4,
          idleSettleMax: 12
        },
        options
      );
      this.mouse = { x: -9999, y: -9999 };
      this._introDone = false;
      this._syncDensityFromViewport();
      this._buildDom();
      this._loadImage();
      this._onResize = () => {
        this._syncDensityFromViewport();
        this._buildGrid();
      };
      window.addEventListener('resize', this._onResize);
      if (typeof ResizeObserver !== 'undefined') {
        this._ro = new ResizeObserver(() => {
          this._syncDensityFromViewport();
          this._buildGrid();
        });
        this._ro.observe(this.container);
      }
    }

    get ramp() {
      const r = this.options.characters;
      return r && r.length >= 2 ? r : DEFAULT_RAMP;
    }
    get gridCols() {
      return this.options.density || 180;
    }
    get activeMode() {
      return MODE_COLORS[this.options.mode] ? this.options.mode : 'dark';
    }

    // Public API ------------------------------------------------------
    setMode(mode) {
      this.options.mode = mode;
    }
    setDensity(density) {
      this.options.density = density;
      this.options.densityBreakpoints = null; // lock to manual density
      this._buildGrid();
    }
    setCharacters(chars) {
      this.options.characters = chars;
      this._buildGrid();
    }
    destroy() {
      cancelAnimationFrame(this.rafId);
      window.removeEventListener('resize', this._onResize);
      if (this._ro) this._ro.disconnect();
      this.canvas.removeEventListener('mousemove', this._onPointerMove);
      this.canvas.removeEventListener('mouseleave', this._onPointerLeave);
      this.canvas.removeEventListener('touchmove', this._onTouchMove);
      this.container.innerHTML = '';
    }

    _syncDensityFromViewport() {
      const bps = this.options.densityBreakpoints;
      if (!bps || !bps.length) return false;
      const sorted = bps.slice().sort(function (a, b) {
        return b.minWidth - a.minWidth;
      });
      const w = window.innerWidth;
      let next = sorted[sorted.length - 1].density;
      for (let i = 0; i < sorted.length; i++) {
        if (w >= sorted[i].minWidth) {
          next = sorted[i].density;
          break;
        }
      }
      if (next === this.options.density) return false;
      this.options.density = next;
      return true;
    }

    // Internal ----------------------------------------------------------
    _buildDom() {
      this.wrapper = document.createElement('div');
      Object.assign(this.wrapper.style, {
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: 'transparent'
      });
      this.canvas = document.createElement('canvas');
      this.canvas.style.display = 'block';
      this.canvas.style.width = '100%';
      this.canvas.style.height = '100%';
      this.wrapper.appendChild(this.canvas);
      this.container.appendChild(this.wrapper);

      this._onPointerMove = (e) => {
        const rect = this.canvas.getBoundingClientRect();
        this.mouse.x = e.clientX - rect.left;
        this.mouse.y = e.clientY - rect.top;
      };
      this._onPointerLeave = () => {
        this.mouse.x = -9999;
        this.mouse.y = -9999;
      };
      this._onTouchMove = (e) => {
        const t = e.touches[0];
        if (t) this._onPointerMove(t);
      };
      this.canvas.addEventListener('mousemove', this._onPointerMove);
      this.canvas.addEventListener('mouseleave', this._onPointerLeave);
      this.canvas.addEventListener('touchmove', this._onTouchMove, { passive: true });
    }

    _loadImage() {
      const img = new Image();
      img.onload = () => {
        this.img = img;
        this.container.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
        this._buildGrid();
        this._updateActivation();
        this._draw();
        this._startLoop();
      };
      img.src = this.options.src;
    }

    _buildGrid() {
      if (!this.img) return;
      const w = this.container.clientWidth || 640;
      const h =
        this.container.clientHeight ||
        Math.round(w * (this.img.naturalHeight / this.img.naturalWidth));
      if (w < 2 || h < 2) return;
      this.cellW = w / this.gridCols;
      this.fontSize = this.cellW / 0.58;
      this.gridRows = Math.max(1, Math.round(h / (this.fontSize * 1.15)));
      this.cellH = h / this.gridRows;
      this.fontSize = this.cellH / 1.15;
      const dpr = window.devicePixelRatio || 1;
      this.canvas.style.width = '100%';
      this.canvas.style.height = '100%';
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.ctx = this.canvas.getContext('2d');
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const sample = document.createElement('canvas');
      sample.width = this.gridCols;
      sample.height = this.gridRows;
      const sctx = sample.getContext('2d');
      sctx.drawImage(this.img, 0, 0, this.gridCols, this.gridRows);
      const data = sctx.getImageData(0, 0, this.gridCols, this.gridRows).data;

      const len = this.gridCols * this.gridRows;
      this.target = new Array(len);
      this.display = new Array(len);
      this.activation = new Array(len).fill(0);
      this.trail = new Array(len).fill(0);
      this.noise = new Array(len);
      this.settle = new Array(len).fill(0);
      this.liveCells = [];
      for (let i = 0; i < len; i++) this.noise[i] = Math.random();
      for (let i = 0; i < len; i++) {
        const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        const idx = Math.min(this.ramp.length - 1, Math.floor(lum * this.ramp.length));
        const ch = this.ramp[idx];
        this.target[i] = ch;
        this.display[i] = ch;
        if (ch && ch !== ' ') this.liveCells.push(i);
      }

      this._idleAcc = 0;
      this._startIntro();
    }

    _prefersReducedMotion() {
      return (
        typeof matchMedia === 'function' &&
        matchMedia('(prefers-reduced-motion: reduce)').matches
      );
    }

    _startIntro() {
      const len = this.target.length;
      const cells = [];
      for (let i = 0; i < len; i++) {
        if (this.target[i] && this.target[i] !== ' ') cells.push(i);
      }
      // Shuffle reveal order
      for (let i = cells.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        const tmp = cells[i];
        cells[i] = cells[j];
        cells[j] = tmp;
      }

      const skip =
        this._introDone ||
        this._prefersReducedMotion() ||
        !this.options.introDuration ||
        cells.length === 0;

      if (skip) {
        this._introDone = true;
        this.revealOrder = null;
        this.revealCount = cells.length;
        return;
      }

      for (let i = 0; i < cells.length; i++) {
        this.display[cells[i]] = ' ';
        this.settle[cells[i]] = 0;
      }
      this.revealOrder = cells;
      this.revealCount = 0;
      this.introStart = performance.now();
    }

    _updateIntro() {
      if (this._introDone || !this.revealOrder) return;
      const duration = this.options.introDuration || 1400;
      const elapsed = performance.now() - this.introStart;
      // Ease-out so denser glyphs arrive toward the end without a hard stop.
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 2.4);
      const targetCount = Math.floor(eased * this.revealOrder.length);

      while (this.revealCount < targetCount) {
        const idx = this.revealOrder[this.revealCount++];
        this.display[idx] = GLYPH_POOL[(Math.random() * GLYPH_POOL.length) | 0];
        this.settle[idx] = 4 + ((Math.random() * 8) | 0);
      }

      for (let i = 0; i < this.settle.length; i++) {
        if (this.settle[i] <= 0) continue;
        this.settle[i]--;
        if (this.settle[i] === 0) {
          this.display[i] = this.target[i];
        } else if (Math.random() < 0.65) {
          this.display[i] = GLYPH_POOL[(Math.random() * GLYPH_POOL.length) | 0];
        }
      }

      if (t >= 1 && this.revealCount >= this.revealOrder.length) {
        let settling = false;
        for (let i = 0; i < this.settle.length; i++) {
          if (this.settle[i] > 0) {
            settling = true;
            break;
          }
        }
        if (!settling) {
          this._introDone = true;
          this.revealOrder = null;
        }
      }
    }

    _startLoop() {
      const tick = () => {
        this.rafId = requestAnimationFrame(tick);
        this._updateIntro();
        this._updateActivation();
        this._updateIdle();
        this._draw();
      };
      this.rafId = requestAnimationFrame(tick);
    }

    _updateIdle() {
      if (!this._introDone || !this.target || !this.liveCells || !this.liveCells.length) return;
      if (this._prefersReducedMotion()) return;
      const rate = this.options.idleBurstsPerSecond;
      if (!rate) return;

      const now = performance.now();
      if (!this._idleLast) this._idleLast = now;
      const dt = Math.min(0.05, (now - this._idleLast) / 1000);
      this._idleLast = now;
      this._idleAcc = (this._idleAcc || 0) + rate * dt;

      while (this._idleAcc >= 1) {
        this._idleAcc -= 1;
        this._sparkIdleCluster();
      }

      for (let i = 0; i < this.settle.length; i++) {
        if (this.settle[i] <= 0) continue;
        // Hover/cluster activation owns the glyph while hot; keep settle for the fade-out.
        if (this.activation[i] > 0.04) continue;
        this.settle[i]--;
        if (this.settle[i] === 0) {
          this.display[i] = this.target[i];
        } else if (Math.random() < 0.55) {
          this.display[i] = GLYPH_POOL[(Math.random() * GLYPH_POOL.length) | 0];
        }
      }
    }

    _sparkIdleCluster() {
      const { gridCols, gridRows, target, display, noise, settle } = this;
      const center = this.liveCells[(Math.random() * this.liveCells.length) | 0];
      const col0 = center % gridCols;
      const row0 = (center / gridCols) | 0;
      const baseReach = (this.options.idleCells != null ? this.options.idleCells : 1) + 0.85;
      const minS = this.options.idleSettleMin || 4;
      const maxS = this.options.idleSettleMax || 12;
      const reachPad = Math.ceil(baseReach * 1.6);

      for (let row = Math.max(0, row0 - reachPad); row <= Math.min(gridRows - 1, row0 + reachPad); row++) {
        for (let col = Math.max(0, col0 - reachPad); col <= Math.min(gridCols - 1, col0 + reachPad); col++) {
          const idx = row * gridCols + col;
          if (!target[idx] || target[idx] === ' ') continue;
          const dx = col - col0;
          const dy = row - row0;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const jaggedReach = baseReach * (0.4 + noise[idx] * 1.2);
          if (dist > jaggedReach) continue;
          display[idx] = GLYPH_POOL[(Math.random() * GLYPH_POOL.length) | 0];
          settle[idx] = minS + ((Math.random() * (maxS - minS + 1)) | 0);
        }
      }
    }

    _updateActivation() {
      const { cellW, cellH, gridCols, gridRows, target, activation, trail, display, mouse } = this;
      if (!target) return;
      // Let the intro own display values until glyphs have settled.
      if (!this._introDone) return;
      const hoverCol = mouse.x / cellW;
      const hoverRow = mouse.y / cellH;
      const baseReach = this.options.hoverCells + 1.5;
      for (let row = 0; row < gridRows; row++) {
        for (let col = 0; col < gridCols; col++) {
          const idx = row * gridCols + col;
          if (target[idx] === ' ') continue;
          const dx = col - hoverCol, dy = row - hoverRow;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const jaggedReach = baseReach * (0.4 + this.noise[idx] * 1.2);
          const near = dist <= jaggedReach;
          if (near) {
            activation[idx] = Math.min(1, activation[idx] + 0.35);
            trail[idx] = 1;
          } else {
            activation[idx] *= 0.85;
          }
          if (activation[idx] > 0.04) {
            if (Math.random() < activation[idx] * 0.6) {
              display[idx] = GLYPH_POOL[(Math.random() * GLYPH_POOL.length) | 0];
            }
          } else if (!(this.settle && this.settle[idx] > 0)) {
            display[idx] = target[idx];
          }
        }
      }
    }

    _draw() {
      const ctx = this.ctx;
      if (!ctx || !this.display) return;
      const { cellW, cellH, gridCols, gridRows, display, activation, trail } = this;
      const c = MODE_COLORS[this.activeMode];
      ctx.clearRect(0, 0, gridCols * cellW, gridRows * cellH);
      ctx.font = `${this.fontSize}px "Berkeley Mono", monospace`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      for (let row = 0; row < gridRows; row++) {
        for (let col = 0; col < gridCols; col++) {
          const idx = row * gridCols + col;
          const ch = display[idx];
          if (!ch || ch === ' ') continue;
          const lit =
            (activation && activation[idx] > 0.04) || (trail && trail[idx] > 0);
          ctx.fillStyle = lit ? c.hover : c.fg;
          ctx.fillText(ch, col * cellW + cellW / 2, row * cellH + cellH / 2);
        }
      }
    }
  }

  window.AsciiPortrait = AsciiPortrait;
})();
