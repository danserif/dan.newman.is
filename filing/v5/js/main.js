// Site initialisation (DOM-ready)
(function () {
	function init() {
		var root = document.documentElement;

		function syncThemeColorMeta() {
			var meta = document.querySelector('meta[name="theme-color"]');
			if (!meta) return;
			meta.setAttribute("content", root.classList.contains("light-mode") ? "#ffffff" : "#000000");
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
		}

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
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}
})();
