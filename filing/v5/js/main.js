// Site initialisation (DOM-ready)
(function () {
	function init() {
		var root = document.documentElement;

		function syncThemeColorMeta() {
			var meta = document.querySelector('meta[name="theme-color"]');
			if (!meta) return;
			meta.setAttribute("content", root.classList.contains("light-mode") ? "#ffffff" : "#000000");
		}

		function colorKeyboardTargetOk() {
			var el = document.activeElement;
			if (!el || el === document.body) return true;
			var tag = el.tagName && el.tagName.toLowerCase();
			if (tag === "input" || tag === "textarea" || tag === "select") return false;
			if (el.isContentEditable) return false;
			return true;
		}

		// Homepage: NZ time ticker
		var timeEl = document.getElementById("nz-time");
		var tzEl = document.getElementById("nz-tz");
		if (timeEl) {
			var tzFmt = new Intl.DateTimeFormat("en-NZ", {
				timeZone: "Pacific/Auckland",
				timeZoneName: "short",
			});
			function tick() {
				var now = new Date();
				timeEl.textContent = now.toLocaleTimeString("en-NZ", {
					hour: "numeric",
					minute: "2-digit",
					second: "2-digit",
					hour12: true,
					timeZone: "Pacific/Auckland",
				});
				var parts = tzFmt.formatToParts(now);
				for (var i = 0; i < parts.length; i++) {
					if (parts[i].type === "timeZoneName") {
						tzEl.textContent = "(" + parts[i].value + ")";
						break;
					}
				}
			}
			tick();
			setInterval(tick, 1000);
		}

		// Homepage: hex colour swatches + 4-mode switching
		var hexEls = {
			black: document.getElementById("hex-black"),
			white: document.getElementById("hex-white"),
			green: document.getElementById("hex-green"),
			blue: document.getElementById("hex-blue"),
		};

		var cycleColorModeFromKey = null;

		if (hexEls.black) {
			function updateActiveHex() {
				var light = root.classList.contains("light-mode");
				var accent = root.classList.contains("accent-bg");
				var activeId = accent ? (light ? "blue" : "green") : light ? "white" : "black";
				for (var key in hexEls) {
					if (hexEls[key]) hexEls[key].classList.toggle("is-active", key === activeId);
				}
			}

			function setModeHome(light, accentBg) {
				root.classList.toggle("light-mode", light);
				root.classList.toggle("accent-bg", accentBg);
				try {
					localStorage.setItem("colorMode", light ? "light" : "dark");
					localStorage.setItem("accentBg", accentBg ? "true" : "false");
				} catch (err) {}
				updateActiveHex();
				syncThemeColorMeta();
			}

			updateActiveHex();

			hexEls.black.addEventListener("click", function () {
				setModeHome(false, false);
			});
			hexEls.white.addEventListener("click", function () {
				setModeHome(true, false);
			});
			hexEls.green.addEventListener("click", function () {
				setModeHome(false, true);
			});
			hexEls.blue.addEventListener("click", function () {
				setModeHome(true, true);
			});

			var modeLight = document.querySelector(".mode-light");
			var modeDark = document.querySelector(".mode-dark");
			if (modeLight) {
				modeLight.addEventListener("click", function (e) {
					e.preventDefault();
					e.stopPropagation();
					setModeHome(true, false);
				});
			}
			if (modeDark) {
				modeDark.addEventListener("click", function (e) {
					e.preventDefault();
					e.stopPropagation();
					setModeHome(false, false);
				});
			}

			/* M key: dark → light → yellow (accent) → blue (light+accent) → … */
			cycleColorModeFromKey = function () {
				var light = root.classList.contains("light-mode");
				var accent = root.classList.contains("accent-bg");
				if (!light && !accent) setModeHome(true, false);
				else if (light && !accent) setModeHome(false, true);
				else if (!light && accent) setModeHome(true, true);
				else setModeHome(false, false);
			};
		} else {
			// Sub-pages: simple dark/light toggle
			function setMode(mode) {
				if (mode === "light") {
					root.classList.add("light-mode");
				} else {
					root.classList.remove("light-mode");
				}
				try {
					localStorage.setItem("colorMode", mode);
				} catch (e) {}
				syncThemeColorMeta();
				if (typeof window.updateGalleryTheme === "function") {
					window.updateGalleryTheme();
				}
			}

			document.addEventListener("click", function (e) {
				if (e.target.classList.contains("mode-dark")) {
					e.preventDefault();
					setMode("dark");
				} else if (e.target.classList.contains("mode-light")) {
					e.preventDefault();
					setMode("light");
				}
			});

			cycleColorModeFromKey = function () {
				setMode(root.classList.contains("light-mode") ? "dark" : "light");
			};
		}

		document.addEventListener("keydown", function (e) {
			if ((e.key !== "m" && e.key !== "M") || e.repeat || e.ctrlKey || e.metaKey || e.altKey) {
				return;
			}
			if (!colorKeyboardTargetOk()) return;
			e.preventDefault();
			if (cycleColorModeFromKey) cycleColorModeFromKey();
		});

		// Sticky header (sub-pages with .header-links)
		var info = document.querySelector(".info");
		if (info && info.querySelector(".header-links")) {
			function checkStuck() {
				info.classList.toggle("is-stuck", info.getBoundingClientRect().top <= 0);
			}
			window.addEventListener("scroll", checkStuck, { passive: true });
			checkStuck();
		}

		// Designer: logo marquee — set exact loop width in px so the animation matches layout after
		// fonts/images load (avoids subpixel seam) and keeps the composited strip size predictable.
		var logoMarqueeTrack = document.querySelector(".logos-marquee-section .marquee-track");
		if (logoMarqueeTrack) {
			function measureLogoMarqueeLoop() {
				var first = logoMarqueeTrack.querySelector("ul");
				if (!first) return;
				var cs = window.getComputedStyle(first);
				var marginRight = parseFloat(cs.marginRight) || 0;
				var w = first.getBoundingClientRect().width;
				var loopPx = w + marginRight;
				if (loopPx > 1) {
					logoMarqueeTrack.style.setProperty("--marquee-loop", loopPx + "px");
				}
			}
			measureLogoMarqueeLoop();
			window.addEventListener("load", measureLogoMarqueeLoop);
			window.addEventListener("resize", measureLogoMarqueeLoop);
			if (document.fonts && document.fonts.ready) {
				document.fonts.ready.then(measureLogoMarqueeLoop);
			}
			if (window.ResizeObserver) {
				var ro = new ResizeObserver(measureLogoMarqueeLoop);
				var firstUl = logoMarqueeTrack.querySelector("ul");
				if (firstUl) ro.observe(firstUl);
			}
		}

		// Homepage: letter-D overlay — scatter first logo letter (path #logo-letter-d from logo.svg)
		var letterDOverlay = document.getElementById("letter-d-overlay");
		var letterDTriggers = document.querySelectorAll(".letter-d-overlay-trigger");
		if (letterDOverlay && letterDTriggers.length) {
			var LETTER_OVERLAY_FADE_MS = 350;
			var letterDViewBox = "";
			var letterDPathTemplate = null;
			var letterDSvgNs = "http://www.w3.org/2000/svg";
			var letterDLoadPromise = null;

			/* Prefer #logo-letter-d. Otherwise use the leftmost <path> by getBBox (D in DAN reads left; avoids wrong "second path" when order is N–A–D). */
			function letterDResolvePathFromLogoDoc(doc) {
				var byId = doc.getElementById("logo-letter-d");
				if (byId) return byId;

				var svgRoot =
					doc.documentElement && doc.documentElement.localName === "svg"
						? doc.documentElement
						: doc.querySelector("svg");
				var paths = svgRoot ? svgRoot.querySelectorAll("path") : doc.querySelectorAll("path");
				if (!paths || paths.length === 0) return null;
				if (paths.length === 1) return paths[0];

				var vb = (svgRoot && svgRoot.getAttribute("viewBox")) || "0 0 100 100";
				var temp = document.createElementNS(letterDSvgNs, "svg");
				temp.setAttribute("xmlns", letterDSvgNs);
				temp.setAttribute("viewBox", vb);
				temp.setAttribute("width", "0");
				temp.setAttribute("height", "0");
				temp.style.cssText =
					"position:absolute;left:-9999px;top:0;visibility:hidden;pointer-events:none";
				document.body.appendChild(temp);

				var bestI = 0;
				var bestLeft = Infinity;
				for (var pi = 0; pi < paths.length; pi++) {
					var probe = paths[pi].cloneNode(true);
					temp.appendChild(probe);
					var box = probe.getBBox();
					temp.removeChild(probe);
					if (box.x < bestLeft) {
						bestLeft = box.x;
						bestI = pi;
					}
				}
				document.body.removeChild(temp);
				return paths[bestI];
			}

			function letterDLoadSvg() {
				if (letterDViewBox && letterDPathTemplate) return Promise.resolve();
				if (letterDLoadPromise) return letterDLoadPromise;
				letterDLoadPromise = fetch("/filing/v5/assets/logo.svg")
					.then(function (r) {
						return r.text();
					})
					.then(function (text) {
						var doc = new DOMParser().parseFromString(text, "image/svg+xml");
						var path = letterDResolvePathFromLogoDoc(doc);
						if (!path) {
							letterDLoadPromise = null;
							return;
						}
						var temp = document.createElementNS(letterDSvgNs, "svg");
						temp.setAttribute("width", "0");
						temp.setAttribute("height", "0");
						temp.style.cssText = "position:absolute;left:-9999px;visibility:hidden";
						var measurePath = path.cloneNode(true);
						temp.appendChild(measurePath);
						document.body.appendChild(temp);
						var box = measurePath.getBBox();
						document.body.removeChild(temp);
						letterDViewBox = box.x + " " + box.y + " " + box.width + " " + box.height;
						letterDPathTemplate = path;
					})
					.catch(function () {
						letterDLoadPromise = null;
					});
				return letterDLoadPromise;
			}

			function letterDClonePath() {
				var p = letterDPathTemplate.cloneNode(true);
				p.removeAttribute("id");
				p.removeAttribute("class");
				p.removeAttribute("style");
				p.removeAttribute("fill");
				p.removeAttribute("clip-rule");
				p.setAttribute("fill", "currentColor");
				if (!p.getAttribute("fill-rule")) p.setAttribute("fill-rule", "evenodd");
				return p;
			}

			function letterDRectsOverlap(a, b) {
				return a.x < b.x + b.s && a.x + a.s > b.x && a.y < b.y + b.s && a.y + a.s > b.y;
			}

			function letterDPopulate() {
				if (!letterDViewBox || !letterDPathTemplate) return;
				var existing = letterDOverlay.querySelectorAll(".letter-d-overlay-item");
				for (var e = 0; e < existing.length; e++) existing[e].remove();
				var vw = window.innerWidth;
				var vh = window.innerHeight;
				var count = Math.round(10 + Math.random() * 10);
				var placed = [];
				var maxAttempts = 200;

				for (var i = 0; i < count; i++) {
					var size = 40 + Math.random() * 100;
					var candidate = null;
					var ok = false;

					for (var attempt = 0; attempt < maxAttempts; attempt++) {
						var x = Math.random() * Math.max(8, vw - size);
						var y = Math.random() * Math.max(8, vh - size);
						candidate = { x: x, y: y, s: size };
						ok = true;
						for (var j = 0; j < placed.length; j++) {
							if (letterDRectsOverlap(candidate, placed[j])) {
								ok = false;
								break;
							}
						}
						if (ok) break;
					}
					if (!ok) continue;

					placed.push(candidate);

					var el = document.createElement("span");
					el.className = "letter-d-overlay-item";
					el.style.width = size + "px";
					el.style.height = size + "px";
					el.style.left = candidate.x + "px";
					el.style.top = candidate.y + "px";
					el.style.transform = "rotate(" + Math.floor(Math.random() * 360) + "deg)";
					var svg = document.createElementNS(letterDSvgNs, "svg");
					svg.setAttribute("viewBox", letterDViewBox);
					svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
					svg.setAttribute("xmlns", letterDSvgNs);
					svg.appendChild(letterDClonePath());
					el.appendChild(svg);
					letterDOverlay.appendChild(el);
				}
			}

			function letterDOverlayVisible() {
				return letterDOverlay.classList.contains("is-visible");
			}

			function letterDShow() {
				if (letterDOverlayVisible()) return;
				letterDLoadSvg().then(function () {
					if (letterDOverlayVisible()) return;
					if (!letterDViewBox || !letterDPathTemplate) return;
					letterDPopulate();
					letterDOverlay.classList.add("is-visible");
					letterDOverlay.setAttribute("aria-hidden", "false");
				});
			}

			function letterDHide() {
				if (!letterDOverlayVisible()) return;
				letterDOverlay.classList.remove("is-visible");
				letterDOverlay.setAttribute("aria-hidden", "true");
				setTimeout(function () {
					var nodes = letterDOverlay.querySelectorAll(".letter-d-overlay-item");
					for (var n = 0; n < nodes.length; n++) nodes[n].remove();
				}, LETTER_OVERLAY_FADE_MS);
			}

			for (var ti = 0; ti < letterDTriggers.length; ti++) {
				letterDTriggers[ti].addEventListener("click", function (e) {
					e.preventDefault();
					letterDShow();
				});
			}

			letterDOverlay.addEventListener("click", function () {
				letterDHide();
			});

			document.addEventListener("keydown", function (e) {
				if (e.key === "Escape" && letterDOverlayVisible()) {
					letterDHide();
					return;
				}
				if (
					(e.key === "d" || e.key === "D") &&
					!e.repeat &&
					!e.ctrlKey &&
					!e.metaKey &&
					!e.altKey &&
					colorKeyboardTargetOk()
				) {
					e.preventDefault();
					if (letterDOverlayVisible()) letterDHide();
					else letterDShow();
				}
			});

			letterDLoadSvg();
		}
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}
})();
