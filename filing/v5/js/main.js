// Site initialisation (DOM-ready)
(function () {
	function init() {
		var root = document.documentElement;

		function syncThemeColorMeta() {
			var meta = document.querySelector('meta[name="theme-color"]');
			if (!meta) return;
			meta.setAttribute(
				"content",
				root.classList.contains("light-mode") ? "#ffffff" : "#000000",
			);
		}

		function setMode(mode) {
			if (mode === "light") {
				root.classList.add("light-mode");
			} else {
				root.classList.remove("light-mode");
			}
			try { localStorage.setItem("colorMode", mode); } catch (e) {}
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

		var info = document.querySelector(".info");
		if (info && info.querySelector(".header-links")) {
			function checkStuck() {
				info.classList.toggle("is-stuck", info.getBoundingClientRect().top <= 0);
			}
			window.addEventListener("scroll", checkStuck, { passive: true });
			checkStuck();
		}
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}
})();
