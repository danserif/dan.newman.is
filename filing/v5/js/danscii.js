/**
 * DANSCII — vanilla JS, no dependencies.
 * Turn any image into an animated ASCII canvas.
 *
 * Usage:
 *   <div id="danscii" style="width:100%"></div>
 *   <script src="danscii.js"><\/script>
 *   <script>
 *     const art = new Danscii(document.getElementById('danscii'), {
 *       src: 'your-image.jpg',
 *       fg: '#f2f2ef',
 *       hover: '#aaff00',
 *       density: 180,
 *       threshold: 0
 *     });
 *     art.setSrc('other.jpg');
 *   <\/script>
 */
(function () {
	const MODE_COLORS = {
		dark: { fg: "#f2f2ef", hover: "#aaff00" },
		light: { fg: "#0a0a0a", hover: "#0044ff" },
		lime: { fg: "#0b1406", hover: "#0b1406" },
		blue: { fg: "#f2f2ef", hover: "#f2f2ef" },
	};
	const DEFAULT_RAMP = " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
	const GLYPH_POOL =
		"@#%*+=-:.,;'\"^~<>[]{}()/\\|abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789░▒▓█■▪▫".split(
			"",
		);

	class Danscii {
		constructor(container, options = {}) {
			this.container = container;
			this.options = Object.assign(
				{
					src: "",
					mode: "dark",
					density: 180,
					densityBreakpoints: [
						{ minWidth: 2661, density: 520 },
						{ minWidth: 1641, density: 440 },
						{ minWidth: 1081, density: 360 },
						{ minWidth: 0, density: 260 },
					],
					characters: "",
					threshold: 0, // 0–100: collapse dark end to blank cells (fewer glyphs)
					fg: "", // optional custom glyph colour (overrides mode palette)
					hover: "", // optional custom hover/trail colour
					hoverCells: 4,
					persistHover: true, // keep hover trail after pointer leaves; false = fade away
					introDuration: 1400,
					idleBurstsPerSecond: 0.35,
					idleCells: 1,
					idleSettleMin: 4,
					idleSettleMax: 12,
					fontFamily: '"Berkeley Mono", monospace',
				},
				options,
			);
			this.mouse = { x: -9999, y: -9999 };
			this._introDone = false;
			this._running = false;
			this._visible = true;
			this._pageVisible = typeof document === "undefined" ? true : !document.hidden;
			this._hovering = false;
			this._dirty = true;
			this._lastW = 0;
			this._lastH = 0;
			this._objectUrl = null;
			this._syncDensityFromViewport();
			this._buildDom();
			this._bindLifecycle();
			this._loadImage();
			this._onResize = () => this._scheduleRebuild();
			window.addEventListener("resize", this._onResize);
			if (typeof ResizeObserver !== "undefined") {
				this._ro = new ResizeObserver(() => this._scheduleRebuild());
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
			return MODE_COLORS[this.options.mode] ? this.options.mode : "dark";
		}

		// Public API ------------------------------------------------------
		setSrc(src) {
			this._revokeObjectUrl();
			if (src && String(src).indexOf("blob:") === 0) {
				this._objectUrl = src;
			}
			this.options.src = src || "";
			this._introDone = false;
			this._invalidateSizeCache();
			this._loadImage();
		}
		setMode(mode) {
			this.options.mode = mode;
			this.options.fg = "";
			this.options.hover = "";
			this._dirty = true;
			this._wake();
		}
		setColors(fg, hover) {
			if (fg) this.options.fg = fg;
			if (hover) this.options.hover = hover;
			this._dirty = true;
			this._wake();
		}
		setDensity(density) {
			this.options.density = density;
			this.options.densityBreakpoints = null;
			this._invalidateSizeCache();
			this._buildGrid();
			this._wake();
		}
		setThreshold(n) {
			const v = Number(n);
			this.options.threshold = Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
			this._invalidateSizeCache();
			this._buildGrid();
			this._wake();
		}
		setCharacters(chars) {
			this.options.characters = chars;
			this._invalidateSizeCache();
			this._buildGrid();
			this._wake();
		}
		setHoverCells(n) {
			this.options.hoverCells = Number(n);
			if (!(this.options.hoverCells > 0) && this.trail) {
				this.trail.fill(0);
				if (this.activation) this.activation.fill(0);
				if (this.display && this.target) {
					for (let i = 0; i < this.display.length; i++) {
						if (!(this.settle && this.settle[i] > 0)) this.display[i] = this.target[i];
					}
				}
			}
			this._dirty = true;
			this._wake();
		}
		setPersistHover(persist) {
			this.options.persistHover = !!persist;
			this._dirty = true;
			this._wake();
		}
		setIntroDuration(ms) {
			this.options.introDuration = Number(ms);
		}
		setIdleBurstsPerSecond(rate) {
			this.options.idleBurstsPerSecond = Number(rate);
			this._wake();
		}
		setIdleCells(n) {
			this.options.idleCells = Number(n);
		}
		setIdleSettleMin(n) {
			this.options.idleSettleMin = Number(n);
		}
		setIdleSettleMax(n) {
			this.options.idleSettleMax = Number(n);
		}
		setFontFamily(family) {
			this.options.fontFamily = family || "monospace";
			this._dirty = true;
			this._wake();
		}
		getColors() {
			if (this.options.fg && this.options.hover) {
				return { fg: this.options.fg, hover: this.options.hover };
			}
			return MODE_COLORS[this.activeMode];
		}
		getOptions() {
			const colors = this.getColors();
			return {
				src: this.options.src,
				mode: this.options.mode,
				fg: colors.fg,
				hover: colors.hover,
				density: this.options.density,
				threshold: this.options.threshold,
				characters: this.options.characters || this.ramp,
				hoverCells: this.options.hoverCells,
				persistHover: !!this.options.persistHover,
				introDuration: this.options.introDuration,
				idleBurstsPerSecond: this.options.idleBurstsPerSecond,
				idleCells: this.options.idleCells,
				idleSettleMin: this.options.idleSettleMin,
				idleSettleMax: this.options.idleSettleMax,
				fontFamily: this.options.fontFamily,
			};
		}
		destroy() {
			this._stopLoop();
			this._clearIdleWake();
			this._revokeObjectUrl();
			if (this._rebuildRaf) cancelAnimationFrame(this._rebuildRaf);
			window.removeEventListener("resize", this._onResize);
			document.removeEventListener("visibilitychange", this._onVisibility);
			if (this._io) this._io.disconnect();
			if (this._ro) this._ro.disconnect();
			this.canvas.removeEventListener("mousemove", this._onPointerMove);
			this.canvas.removeEventListener("mouseleave", this._onPointerLeave);
			this.canvas.removeEventListener("touchstart", this._onTouchMove);
			this.canvas.removeEventListener("touchmove", this._onTouchMove);
			this.container.innerHTML = "";
		}

		_revokeObjectUrl() {
			if (this._objectUrl) {
				try {
					URL.revokeObjectURL(this._objectUrl);
				} catch (e) {}
				this._objectUrl = null;
			}
		}

		_invalidateSizeCache() {
			this._lastW = 0;
			this._lastH = 0;
			this._lastDensity = null;
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

		_buildDom() {
			this.wrapper = document.createElement("div");
			Object.assign(this.wrapper.style, {
				position: "relative",
				width: "100%",
				height: "100%",
				overflow: "hidden",
				background: "transparent",
			});
			this.canvas = document.createElement("canvas");
			this.canvas.style.display = "block";
			this.canvas.style.width = "100%";
			this.canvas.style.height = "100%";
			this.wrapper.appendChild(this.canvas);
			this.container.appendChild(this.wrapper);

			this._onPointerMove = (e) => {
				const rect = this.canvas.getBoundingClientRect();
				this.mouse.x = e.clientX - rect.left;
				this.mouse.y = e.clientY - rect.top;
				this._hovering = true;
				this._dirty = true;
				this._wake();
			};
			this._onPointerLeave = () => {
				this.mouse.x = -9999;
				this.mouse.y = -9999;
				this._hovering = false;
				this._dirty = true;
				this._wake();
			};
			this._onTouchMove = (e) => {
				const t = e.touches[0];
				if (t) this._onPointerMove(t);
			};
			this.canvas.addEventListener("mousemove", this._onPointerMove);
			this.canvas.addEventListener("mouseleave", this._onPointerLeave);
			this.canvas.addEventListener("touchstart", this._onTouchMove, { passive: true });
			this.canvas.addEventListener("touchmove", this._onTouchMove, { passive: true });
		}

		_bindLifecycle() {
			this._onVisibility = () => {
				this._pageVisible = !document.hidden;
				if (this._pageVisible) this._wake();
				else this._stopLoop();
			};
			document.addEventListener("visibilitychange", this._onVisibility);

			if (typeof IntersectionObserver !== "undefined") {
				this._io = new IntersectionObserver(
					(entries) => {
						const entry = entries[0];
						this._visible = !!(entry && entry.isIntersecting);
						if (this._visible) this._wake();
						else this._stopLoop();
					},
					{ root: null, threshold: 0.01 },
				);
				this._io.observe(this.container);
			}
		}

		_scheduleRebuild() {
			if (this._rebuildRaf) return;
			this._rebuildRaf = requestAnimationFrame(() => {
				this._rebuildRaf = null;
				this._syncDensityFromViewport();
				this._buildGrid();
				this._wake();
			});
		}

		_emitImageError(detail) {
			if (typeof this.options.onImageError === "function") {
				try {
					this.options.onImageError(detail);
				} catch (e) {}
			}
		}

		_emitImageReady() {
			if (typeof this.options.onImageReady === "function") {
				try {
					this.options.onImageReady();
				} catch (e) {}
			}
		}

		_loadImage() {
			const src = this.options.src;
			if (!src) return;
			const img = new Image();
			img.onload = () => {
				this.img = img;
				this.container.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
				this._invalidateSizeCache();
				this._buildGrid();
				this._wake();
			};
			img.onerror = () => {
				console.warn("D@N5C1I: failed to load image", src);
				this._emitImageError({ type: "load", src: src });
			};
			img.src = src;
		}

		_buildGrid() {
			if (!this.img) return;
			const w = this.container.clientWidth || 640;
			const h =
				this.container.clientHeight ||
				Math.round(w * (this.img.naturalHeight / this.img.naturalWidth));
			if (w < 2 || h < 2) return;

			const dens = this.gridCols;
			if (w === this._lastW && h === this._lastH && dens === this._lastDensity && this.target) {
				return;
			}
			this._lastW = w;
			this._lastH = h;
			this._lastDensity = dens;

			this.cellW = w / dens;
			this.fontSize = this.cellW / 0.58;
			this.gridRows = Math.max(1, Math.round(h / (this.fontSize * 1.2)));
			this.cellH = h / this.gridRows;
			this.fontSize = this.cellH / 1.2;
			const dpr = window.devicePixelRatio || 1;
			this.canvas.style.width = "100%";
			this.canvas.style.height = "100%";
			this.canvas.width = Math.round(w * dpr);
			this.canvas.height = Math.round(h * dpr);
			this.ctx = this.canvas.getContext("2d");
			this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

			const sample = document.createElement("canvas");
			sample.width = dens;
			sample.height = this.gridRows;
			const sctx = sample.getContext("2d");
			sctx.drawImage(this.img, 0, 0, dens, this.gridRows);
			let data;
			try {
				data = sctx.getImageData(0, 0, dens, this.gridRows).data;
			} catch (err) {
				// file:// + sibling image often taints the canvas in browsers.
				console.warn(
					"D@N5C1I: cannot read image pixels (open via http, or load with a file picker / data URL).",
					err,
				);
				this._emitImageError({ type: "sample", error: err });
				return;
			}

			const len = dens * this.gridRows;
			this.target = new Array(len);
			this.display = new Array(len);
			this.activation = new Float32Array(len);
			this.trail = new Float32Array(len);
			this.noise = new Float32Array(len);
			this.settle = new Int16Array(len);
			this.liveCells = [];
			for (let i = 0; i < len; i++) this.noise[i] = Math.random();
			const ramp = this.ramp;
			const thr = Math.max(0, Math.min(95, Number(this.options.threshold) || 0)) / 100;
			for (let i = 0; i < len; i++) {
				const r = data[i * 4],
					g = data[i * 4 + 1],
					b = data[i * 4 + 2];
				const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
				// Collapse the dark end to blank so higher threshold = fewer glyphs.
				const t = thr > 0 ? (lum <= thr ? 0 : (lum - thr) / (1 - thr)) : lum;
				const idx = Math.min(ramp.length - 1, Math.floor(t * ramp.length));
				const ch = ramp[idx];
				this.target[i] = ch;
				this.display[i] = ch;
				if (ch && ch !== " ") this.liveCells.push(i);
			}

			this._idleAcc = 0;
			this._dirty = true;
			this._startIntro();
			this._emitImageReady();
		}

		_prefersReducedMotion() {
			return (
				typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
			);
		}

		_startIntro() {
			const len = this.target.length;
			const cells = [];
			for (let i = 0; i < len; i++) {
				if (this.target[i] && this.target[i] !== " ") cells.push(i);
			}
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
				this._dirty = true;
				return;
			}

			for (let i = 0; i < cells.length; i++) {
				this.display[cells[i]] = " ";
				this.settle[cells[i]] = 0;
			}
			this.revealOrder = cells;
			this.revealCount = 0;
			this.introStart = performance.now();
			this._dirty = true;
		}

		_updateIntro() {
			if (this._introDone || !this.revealOrder) return false;
			const duration = this.options.introDuration || 1400;
			const elapsed = performance.now() - this.introStart;
			const t = Math.min(1, elapsed / duration);
			const eased = 1 - Math.pow(1 - t, 2.4);
			const targetCount = Math.floor(eased * this.revealOrder.length);
			let changed = false;

			while (this.revealCount < targetCount) {
				const idx = this.revealOrder[this.revealCount++];
				this.display[idx] = GLYPH_POOL[(Math.random() * GLYPH_POOL.length) | 0];
				this.settle[idx] = 4 + ((Math.random() * 8) | 0);
				changed = true;
			}

			for (let i = 0; i < this.settle.length; i++) {
				if (this.settle[i] <= 0) continue;
				this.settle[i]--;
				changed = true;
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
					changed = true;
				}
			}
			return changed;
		}

		_hasActiveSettle() {
			const s = this.settle;
			if (!s) return false;
			for (let i = 0; i < s.length; i++) {
				if (s[i] > 0) return true;
			}
			return false;
		}

		_hasCoolingMotion() {
			const a = this.activation;
			if (a) {
				for (let i = 0; i < a.length; i++) {
					if (a[i] > 0.01) return true;
				}
			}
			// When trail is set to fade, keep the loop alive until paint clears.
			if (!this.options.persistHover && this.trail) {
				for (let i = 0; i < this.trail.length; i++) {
					if (this.trail[i] > 0.01) return true;
				}
			}
			return false;
		}

		_shouldAnimate() {
			if (!this._pageVisible || !this._visible) return false;
			if (!this.target) return false;
			if (!this._introDone) return true;
			if (this._hovering) return true;
			if (this._hasActiveSettle()) return true;
			if (this._hasCoolingMotion()) return true;
			return false;
		}

		_wake() {
			if (!this._pageVisible || !this._visible) {
				this._scheduleIdleWake();
				return;
			}
			this._clearIdleWake();
			if (!this._running) this._startLoop();
		}

		_startLoop() {
			if (this._running) return;
			this._running = true;
			this._idleLast = performance.now();
			const tick = () => {
				if (!this._running) return;
				this.rafId = requestAnimationFrame(tick);

				let changed = false;
				if (this._updateIntro()) changed = true;
				if (this._updateActivation()) changed = true;
				if (this._updateIdle()) changed = true;

				if (changed || this._dirty) {
					this._draw();
					this._dirty = false;
				}

				if (!this._shouldAnimate()) {
					this._stopLoop();
					this._scheduleIdleWake();
				}
			};
			this.rafId = requestAnimationFrame(tick);
		}

		_stopLoop() {
			this._running = false;
			if (this.rafId) {
				cancelAnimationFrame(this.rafId);
				this.rafId = 0;
			}
		}

		_scheduleIdleWake() {
			this._clearIdleWake();
			if (!this._pageVisible || !this._visible) return;
			if (this._prefersReducedMotion()) return;
			const rate = this.options.idleBurstsPerSecond;
			if (!rate || !this._introDone) return;
			const delay = Math.max(200, (1000 / rate) * (0.7 + Math.random() * 0.6));
			this._idleWakeTimer = setTimeout(() => {
				this._idleWakeTimer = null;
				if (!this._introDone || !this.liveCells || !this.liveCells.length) return;
				this._sparkIdleCluster();
				this._dirty = true;
				this._wake();
			}, delay);
		}

		_clearIdleWake() {
			if (this._idleWakeTimer) {
				clearTimeout(this._idleWakeTimer);
				this._idleWakeTimer = null;
			}
		}

		_updateIdle() {
			if (!this._introDone || !this.target || !this.liveCells || !this.liveCells.length)
				return false;
			if (this._prefersReducedMotion()) return false;
			const rate = this.options.idleBurstsPerSecond;
			if (!rate) return false;

			let changed = false;
			const now = performance.now();
			if (!this._idleLast) this._idleLast = now;
			const dt = Math.min(0.05, (now - this._idleLast) / 1000);
			this._idleLast = now;
			this._idleAcc = (this._idleAcc || 0) + rate * dt;

			while (this._idleAcc >= 1) {
				this._idleAcc -= 1;
				this._sparkIdleCluster();
				changed = true;
			}

			for (let i = 0; i < this.settle.length; i++) {
				if (this.settle[i] <= 0) continue;
				if (this.activation[i] > 0.04) continue;
				this.settle[i]--;
				changed = true;
				if (this.settle[i] === 0) {
					this.display[i] = this.target[i];
				} else if (Math.random() < 0.55) {
					this.display[i] = GLYPH_POOL[(Math.random() * GLYPH_POOL.length) | 0];
				}
			}
			return changed;
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

			for (
				let row = Math.max(0, row0 - reachPad);
				row <= Math.min(gridRows - 1, row0 + reachPad);
				row++
			) {
				for (
					let col = Math.max(0, col0 - reachPad);
					col <= Math.min(gridCols - 1, col0 + reachPad);
					col++
				) {
					const idx = row * gridCols + col;
					if (!target[idx] || target[idx] === " ") continue;
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
			if (!target) return false;
			if (!this._introDone) return false;
			const hovering = this._hovering;
			let changed = false;
			if (!hovering && !this._hasCoolingMotion()) return false;

			const persist = this.options.persistHover !== false;

			if (!hovering) {
				for (let idx = 0; idx < activation.length; idx++) {
					if (target[idx] === " ") continue;
					let cellChanged = false;
					if (activation[idx] > 0) {
						activation[idx] *= 0.85;
						if (activation[idx] < 0.001) activation[idx] = 0;
						cellChanged = true;
					}
					if (!persist && trail[idx] > 0) {
						trail[idx] *= 0.82;
						if (trail[idx] < 0.01) trail[idx] = 0;
						cellChanged = true;
					}
					if (!cellChanged) continue;
					changed = true;
					if (activation[idx] > 0.04) {
						if (Math.random() < activation[idx] * 0.6) {
							display[idx] = GLYPH_POOL[(Math.random() * GLYPH_POOL.length) | 0];
						}
					} else if (!(this.settle && this.settle[idx] > 0)) {
						display[idx] = target[idx];
					}
				}
				return changed;
			}

			// hoverCells 0 = hover effect off; otherwise brush radius in grid cells.
			const hoverCells = Number(this.options.hoverCells);
			if (!(hoverCells > 0)) {
				for (let idx = 0; idx < activation.length; idx++) {
					if (target[idx] === " ") continue;
					let cellChanged = false;
					if (activation[idx] > 0) {
						activation[idx] *= 0.85;
						if (activation[idx] < 0.001) activation[idx] = 0;
						cellChanged = true;
					}
					if (!persist && trail[idx] > 0) {
						trail[idx] *= 0.82;
						if (trail[idx] < 0.01) trail[idx] = 0;
						cellChanged = true;
					} else if (persist && trail[idx] > 0) {
						// Clear leftover trail when hover is disabled.
						trail[idx] = 0;
						cellChanged = true;
					}
					if (!cellChanged) continue;
					changed = true;
					if (activation[idx] > 0.04) {
						if (Math.random() < activation[idx] * 0.6) {
							display[idx] = GLYPH_POOL[(Math.random() * GLYPH_POOL.length) | 0];
						}
					} else if (!(this.settle && this.settle[idx] > 0)) {
						display[idx] = target[idx];
					}
				}
				return changed;
			}

			const hoverCol = mouse.x / cellW;
			const hoverRow = mouse.y / cellH;
			// hoverCells is the brush radius in grid cells (slider maps 1:1).
			const baseReach = hoverCells;

			for (let row = 0; row < gridRows; row++) {
				for (let col = 0; col < gridCols; col++) {
					const idx = row * gridCols + col;
					if (target[idx] === " ") continue;
					const dx = col - hoverCol,
						dy = row - hoverRow;
					const dist = Math.sqrt(dx * dx + dy * dy);
					const jaggedReach = baseReach * (0.4 + this.noise[idx] * 1.2);
					const near = dist <= jaggedReach;
					if (near) {
						activation[idx] = Math.min(1, activation[idx] + 0.35);
						trail[idx] = 1;
					} else {
						activation[idx] *= 0.85;
						if (activation[idx] < 0.001) activation[idx] = 0;
						if (!persist && trail[idx] > 0) {
							trail[idx] *= 0.82;
							if (trail[idx] < 0.01) trail[idx] = 0;
						}
					}
					changed = true;
					if (activation[idx] > 0.04) {
						if (Math.random() < activation[idx] * 0.6) {
							display[idx] = GLYPH_POOL[(Math.random() * GLYPH_POOL.length) | 0];
						}
					} else if (!(this.settle && this.settle[idx] > 0)) {
						display[idx] = target[idx];
					}
				}
			}
			return changed;
		}

		_draw() {
			const ctx = this.ctx;
			if (!ctx || !this.display) return;
			const { cellW, cellH, gridCols, gridRows, display, activation, trail } = this;
			const c = this.getColors();
			ctx.clearRect(0, 0, gridCols * cellW, gridRows * cellH);
			ctx.font = `${this.fontSize}px ${this.options.fontFamily || "monospace"}`;
			ctx.textBaseline = "middle";
			ctx.textAlign = "center";
			for (let row = 0; row < gridRows; row++) {
				for (let col = 0; col < gridCols; col++) {
					const idx = row * gridCols + col;
					const ch = display[idx];
					if (!ch || ch === " ") continue;
					const lit = (activation && activation[idx] > 0.04) || (trail && trail[idx] > 0);
					ctx.fillStyle = lit ? c.hover : c.fg;
					ctx.fillText(ch, col * cellW + cellW / 2, row * cellH + cellH / 2);
				}
			}
		}

		/**
		 * Render a PNG canvas of the current ASCII (includes hover trail).
		 * @param {{ scale?: number, background?: string }} [options]
		 * @returns {HTMLCanvasElement|null}
		 */
		exportCanvas(options = {}) {
			const chars = this.display || this.target;
			if (!chars || !this.gridCols || !this.gridRows) return null;
			const scale = options.scale > 0 ? Number(options.scale) : 2;
			const background = options.background || "#000000";
			const cellW = this.cellW * scale;
			const cellH = this.cellH * scale;
			const fontSize = this.fontSize * scale;
			const canvas = document.createElement("canvas");
			canvas.width = Math.max(1, Math.round(this.gridCols * cellW));
			canvas.height = Math.max(1, Math.round(this.gridRows * cellH));
			const ctx = canvas.getContext("2d");
			ctx.fillStyle = background;
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			ctx.font = `${fontSize}px ${this.options.fontFamily || "monospace"}`;
			ctx.textBaseline = "middle";
			ctx.textAlign = "center";
			const c = this.getColors();
			const { activation, trail } = this;
			for (let row = 0; row < this.gridRows; row++) {
				for (let col = 0; col < this.gridCols; col++) {
					const idx = row * this.gridCols + col;
					const ch = chars[idx];
					if (!ch || ch === " ") continue;
					const lit = (activation && activation[idx] > 0.04) || (trail && trail[idx] > 0);
					ctx.fillStyle = lit ? c.hover : c.fg;
					ctx.fillText(ch, col * cellW + cellW / 2, row * cellH + cellH / 2);
				}
			}
			return canvas;
		}
	}

	window.Danscii = Danscii;
})();
