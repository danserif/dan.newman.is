// Light/Dark Mode — apply immediately to prevent flash
(function () {
	var root = document.documentElement;
	var saved = localStorage.getItem("colorMode") || "dark";
	if (saved === "light") root.classList.add("light-mode");
})();

// Accent color value display (used by design-system pages)
window.updateAccentColorValue = function () {
	var el = document.getElementById("accent-color-value");
	if (!el) return;
	var isLight = document.documentElement.classList.contains("light-mode");
	el.textContent = isLight ? "#0044FF" : "#aaff00";
};

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", window.updateAccentColorValue);
} else {
	window.updateAccentColorValue();
}

// Clock — Aotearoa / New Zealand time
function updateClocks() {
	var now = new Date();
	var tz = "Pacific/Auckland";
	var time = now.toLocaleString("en-NZ", {
		timeZone: tz,
		hour: "numeric",
		minute: "2-digit",
		second: "2-digit",
		hour12: true,
	});
	var tzString = now.toLocaleTimeString("en-NZ", {
		timeZone: tz,
		timeZoneName: "short",
	});
	var tzAbbr = tzString.includes("DT") ? "NZDT" : "NZST";

	var clockEl = document.getElementById("header-clock");
	var tzEl = document.getElementById("header-clock-gmt");
	if (clockEl) clockEl.textContent = "\u2014 " + time + " ";
	if (tzEl) tzEl.textContent = "(" + tzAbbr + ")";
}

updateClocks();
setTimeout(function () {
	setInterval(updateClocks, 1000);
}, 100);

// ASCII hero placeholder
(function () {
	var el = document.getElementById("hero-ascii-text");
	if (el && !el.textContent.trim()) {
		el.textContent = "x".repeat(12000);
	}
})();

// Site initialisation (DOM-ready)
function initSite() {
	var root = document.documentElement;

	function syncThemeColorMeta() {
		var meta = document.querySelector('meta[name="theme-color"]');
		if (!meta) return;
		meta.setAttribute(
			"content",
			root.classList.contains("light-mode") ? "#ffffff" : "#000000",
		);
	}

	// Light / Dark toggle — event delegation
	document.addEventListener("click", function (e) {
		if (e.target.classList.contains("dark-mode-toggle")) {
			e.preventDefault();
			if (typeof fathom !== "undefined" && fathom.trackEvent)
				fathom.trackEvent("Dark", 0);
			root.classList.remove("light-mode");
			localStorage.setItem("colorMode", "dark");
			updateAccentColorValue();
			syncThemeColorMeta();
			if (typeof window.updateGalleryTheme === "function")
				window.updateGalleryTheme();
		} else if (e.target.classList.contains("light-mode-toggle")) {
			e.preventDefault();
			if (typeof fathom !== "undefined" && fathom.trackEvent)
				fathom.trackEvent("Light", 0);
			root.classList.add("light-mode");
			localStorage.setItem("colorMode", "light");
			updateAccentColorValue();
			syncThemeColorMeta();
			if (typeof window.updateGalleryTheme === "function")
				window.updateGalleryTheme();
		}
	});
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", initSite);
} else {
	initSite();
}
