// Global navigation overlay / panel (mobile + desktop)
(function () {
	"use strict";

	function workSectionIntersectsViewport() {
		var workSection = document.getElementById("work");
		if (!workSection) return false;
		var r = workSection.getBoundingClientRect();
		var vv = window.visualViewport;
		var vTop = vv ? vv.offsetTop : 0;
		var vLeft = vv ? vv.offsetLeft : 0;
		var vh = vv && vv.height ? vv.height : window.innerHeight;
		var vw = vv && vv.width ? vv.width : window.innerWidth;
		return (
			r.bottom > vTop &&
			r.top < vTop + vh &&
			r.right > vLeft &&
			r.left < vLeft + vw
		);
	}

	function syncNavBackdropGrayscaleForWork() {
		var overlay = document.getElementById("nav-overlay");
		var root = document.documentElement;
		if (!overlay || !overlay.classList.contains("is-open")) {
			root.classList.remove("nav-overlay-page-grayscale-over-work");
			return;
		}
		root.classList.toggle("nav-overlay-page-grayscale-over-work", workSectionIntersectsViewport());
	}

	window.syncNavBackdropGrayscaleForWork = syncNavBackdropGrayscaleForWork;

	function initNavOverlay() {
		var overlay = document.querySelector("[data-nav-overlay]");
		var root = document.documentElement;
		var themeMeta = document.querySelector('meta[name="theme-color"]');
		var panel = overlay ? overlay.querySelector(".nav-panel") : null;
		var panelScroll = overlay ? overlay.querySelector(".nav-panel-scroll") : null;
		var closeBtn = overlay ? overlay.querySelector(".nav-panel-close") : null;
		var linksContainer = overlay ? overlay.querySelector("[data-nav-panel-links]") : null;
		var toggles = document.querySelectorAll(".nav-toggle");
		var headerNav = document.querySelector(".header-nav");

		if (
			!overlay ||
			!panel ||
			!panelScroll ||
			!closeBtn ||
			!linksContainer ||
			!headerNav ||
			!toggles.length
		) {
			return;
		}

		var originalList = headerNav.querySelector(".anchor-links");
		if (!originalList) return;

		var lastTrigger = null;

		function cloneLinks() {
			// Clear any existing items
			while (linksContainer.firstChild) {
				linksContainer.removeChild(linksContainer.firstChild);
			}

			originalList.querySelectorAll("li").forEach(function (item) {
				var cloneLi = item.cloneNode(true);
				linksContainer.appendChild(cloneLi);
			});
		}

		function isSamePageHashLink(link) {
			if (!link) return false;
			var href = link.getAttribute("href") || "";
			if (!href) return false;
			if (href[0] === "#") return true;
			try {
				var url = new URL(href, window.location.href);
				return (
					url.origin === window.location.origin &&
					url.pathname === window.location.pathname &&
					!!url.hash
				);
			} catch (e) {
				return false;
			}
		}

		function getHashFromLink(link) {
			var href = link.getAttribute("href") || "";
			if (!href) return "";
			if (href[0] === "#") return href;
			try {
				var url = new URL(href, window.location.href);
				return url.hash || "";
			} catch (e) {
				return "";
			}
		}

		function scrollToHash(hash) {
			if (!hash || hash === "#") return;
			var id = hash.slice(1);
			try {
				id = decodeURIComponent(id);
			} catch (e) {}
			var el = document.getElementById(id);
			if (!el) {
				// Fallback for legacy named anchors
				var esc =
					window.CSS && typeof window.CSS.escape === "function"
						? window.CSS.escape
						: function (s) {
								return String(s).replace(/[^a-zA-Z0-9_\u00A0-\uFFFF-]/g, "\\$&");
							};
				el = document.querySelector('[name="' + esc(id) + '"]');
			}
			if (!el) return;

			// Ensure URL reflects the target without triggering native scroll twice
			try {
				history.pushState(null, "", hash);
			} catch (e) {
				// If pushState fails, fall back to assigning hash
				window.location.hash = hash;
			}

			// Allow layout to settle after unlocking body scroll / panel close transition
			requestAnimationFrame(function () {
				requestAnimationFrame(function () {
					el.scrollIntoView({ behavior: "smooth", block: "start" });
				});
			});
		}

		function handleNavLinkClick(event) {
			var target = event.target;
			if (!target) return;

			var link = target.closest("a");
			if (!link) return;

			if (isSamePageHashLink(link)) {
				// For same-page anchors: close menu first (unlocks body), then perform the scroll.
				event.preventDefault();
				var hash = getHashFromLink(link);
				closeOverlay(false, function () {
					scrollToHash(hash);
				});
			} else {
				// Close overlay for regular anchor navigation and allow default behavior
				closeOverlay();
			}
		}

		function getMenuThemeColor() {
			if (!root) return "#000000";
			return root.classList.contains("light-mode") ? "#0044FF" : "#aaff00";
		}

		function getPageBgColor() {
			if (!root) return "#000000";
			return root.classList.contains("light-mode") ? "#ffffff" : "#000000";
		}

		function setThemeColorForMenu(isOpen) {
			if (!themeMeta) themeMeta = document.querySelector('meta[name="theme-color"]');
			if (themeMeta) {
				themeMeta.setAttribute("content", isOpen ? getMenuThemeColor() : getPageBgColor());
			}
			// Safari 26: all fixed elements have backdrop-filter: saturate(100%)
			// on mobile, which disqualifies them from toolbar tinting. Safari
			// falls back to body background, so we control tint via body bg.
			if (isMobileViewport()) {
				document.body.style.backgroundColor = isOpen ? getMenuThemeColor() : getPageBgColor();
			}
		}

		var OVERLAY_FADE_MS = 280;
		// Extra delay before removing overlay so it stays until panel is fully off; can reduce theme flash on close.
		var OVERLAY_CLOSE_DELAY_MS = 380;

		var bodyScrollLocked = false;
		var MOBILE_MAX_WIDTH = 1080;
		var overlayTouchMoveHandler = null;
		var panelScrollTouchMoveHandler = null;

		function isMobileViewport() {
			return typeof window !== "undefined" && window.innerWidth <= MOBILE_MAX_WIDTH;
		}

		function lockBodyScroll() {
			if (!document.body || bodyScrollLocked) return;
			document.body.style.overflow = "hidden";
			bodyScrollLocked = true;
		}

		function unlockBodyScroll() {
			if (!document.body || !bodyScrollLocked) return;
			document.body.style.overflow = "";
			bodyScrollLocked = false;
		}

		function finishOpenOverlay(trigger) {
			setThemeColorForMenu(true);
			overlay.classList.add("is-open");
			syncNavBackdropGrayscaleForWork();
			if (trigger) {
				trigger.setAttribute("aria-expanded", "true");
			}

			if (isMobileViewport()) {
				lockBodyScroll();

				if (!overlayTouchMoveHandler) {
					overlayTouchMoveHandler = function (e) {
						if (e.target === overlay) {
							e.preventDefault();
						}
					};
					overlay.addEventListener("touchmove", overlayTouchMoveHandler, { passive: false });
				}
				if (!panelScrollTouchMoveHandler) {
					panelScrollTouchMoveHandler = function (e) {
						e.stopPropagation();
					};
					panelScroll.addEventListener("touchmove", panelScrollTouchMoveHandler, { passive: true });
				}
			}

			// On mobile the overlay appears instantly (transition: none), so use a
			// short delay to let the accent background paint before the panel slides
			// in. On desktop the longer fade lets the opacity transition complete.
			var panelDelay = isMobileViewport() ? 50 : OVERLAY_FADE_MS;
			setTimeout(function () {
				overlay.classList.add("is-panel-open");
			}, panelDelay);

			closeBtn.focus();
		}

		function openOverlay(trigger) {
			if (!overlay || !panel) return;
			lastTrigger = trigger || null;

			cloneLinks();

			finishOpenOverlay(trigger);
		}

		function restoreTriggerFocus() {
			if (!lastTrigger || typeof lastTrigger.focus !== "function") return;
			// Try to restore focus without causing a scroll jump (Chrome/Safari support).
			try {
				lastTrigger.focus({ preventScroll: true });
			} catch (e) {
				// If the browser doesn’t support the option, skip focusing to avoid snapping.
			}
		}

		function closeOverlay(immediate, onClosed) {
			if (!overlay) return;

			overlay.classList.remove("is-panel-open");
			if (immediate) {
				overlay.classList.remove("is-open");
				syncNavBackdropGrayscaleForWork();
				setThemeColorForMenu(false);
				if (overlayTouchMoveHandler) {
					overlay.removeEventListener("touchmove", overlayTouchMoveHandler);
					overlayTouchMoveHandler = null;
				}
				if (panelScrollTouchMoveHandler) {
					panelScroll.removeEventListener("touchmove", panelScrollTouchMoveHandler);
					panelScrollTouchMoveHandler = null;
				}
				if (bodyScrollLocked) {
					unlockBodyScroll();
				}
				if (lastTrigger) {
					lastTrigger.setAttribute("aria-expanded", "false");
					restoreTriggerFocus();
				}
				if (typeof onClosed === "function") onClosed();
				return;
			}
			// Remove overlay and restore theme only after panel has fully slid off (no fade, just delay).
			setTimeout(function () {
				overlay.classList.remove("is-open");
				syncNavBackdropGrayscaleForWork();
				setThemeColorForMenu(false);
				if (overlayTouchMoveHandler) {
					overlay.removeEventListener("touchmove", overlayTouchMoveHandler);
					overlayTouchMoveHandler = null;
				}
				if (panelScrollTouchMoveHandler) {
					panelScroll.removeEventListener("touchmove", panelScrollTouchMoveHandler);
					panelScrollTouchMoveHandler = null;
				}
				if (bodyScrollLocked) {
					unlockBodyScroll();
				}
				if (lastTrigger) {
					lastTrigger.setAttribute("aria-expanded", "false");
					restoreTriggerFocus();
				}
				if (typeof onClosed === "function") onClosed();
			}, OVERLAY_CLOSE_DELAY_MS);
		}

		function handleToggleClick(e) {
			e.preventDefault();
			openOverlay(this);
		}

		// Bind the same handler to all nav toggles (mobile + desktop)
		toggles.forEach(function (btn) {
			btn.addEventListener("click", handleToggleClick);
		});

		closeBtn.addEventListener("click", function () {
			closeOverlay();
		});

		overlay.addEventListener("click", function (event) {
			if (!panel.contains(event.target)) {
				closeOverlay();
			}
		});

		document.addEventListener("keydown", function (event) {
			if (event.key === "Escape" || event.key === "Esc") {
				if (overlay.classList.contains("is-open")) {
					event.preventDefault();
					closeOverlay();
				}
			}
		});

		linksContainer.addEventListener("click", handleNavLinkClick);

		window.updateNavOverlayBackground = function () {
			if (!overlay) return;
			if (overlay.classList.contains("is-open") && isMobileViewport()) {
				setThemeColorForMenu(true);
			}
			syncNavBackdropGrayscaleForWork();
		};

		window.addEventListener("scroll", syncNavBackdropGrayscaleForWork, { passive: true });
		window.addEventListener("resize", syncNavBackdropGrayscaleForWork, { passive: true });
		if (window.visualViewport) {
			window.visualViewport.addEventListener("resize", syncNavBackdropGrayscaleForWork);
			window.visualViewport.addEventListener("scroll", syncNavBackdropGrayscaleForWork);
		}
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", initNavOverlay);
	} else {
		initNavOverlay();
	}
})();
