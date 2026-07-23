// gallery.js
// Graphics / Photos

document.addEventListener("DOMContentLoaded", function () {
	const ITEMS_PER_PAGE = 12;

	// Development controls: Temporarily disable JSON loading
	// Set to true to skip loading JSON data
	const DISABLE_JSON_LOADING = false;
	/* Keep in sync with filter bar CSS (mobile nav + sticky handoff). */
	const FILTER_BAR_MOBILE_MQL = "(max-width: 1080px)";

	// Theme-aware images: tracks light variants that 404'd so we don't retry them
	const lightImageMissing = new Set();

	/** Shared fullscreen lightbox (one per page). */
	var galleryLightboxApi = null;

	/** Average image colours keyed by src (photos lightbox ambient bg). */
	var lightboxColorCache = Object.create(null);
	var ambientDesktopMql = window.matchMedia(FILTER_BAR_MOBILE_MQL);

	function ambientBackgroundAllowed() {
		/* Mobile keeps the normal light/dark page background. */
		return !ambientDesktopMql.matches;
	}

	function clampByte(n) {
		return Math.max(0, Math.min(255, Math.round(n)));
	}

	function rgbToHex(r, g, b) {
		return (
			"#" +
			((1 << 24) + (clampByte(r) << 16) + (clampByte(g) << 8) + clampByte(b))
				.toString(16)
				.slice(1)
		);
	}

	/** Multiply RGB toward black (0.1 = 10% darker). Preset bgColor skips this. */
	function darkenCssColor(value, amount) {
		var rgb = parseCssColor(value);
		if (!rgb) return value;
		var f = 1 - amount;
		return rgbToHex(rgb.r * f, rgb.g * f, rgb.b * f);
	}

	function parseCssColor(value) {
		if (!value || typeof value !== "string") return null;
		var s = value.trim();
		var hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
		if (hex) {
			var h = hex[1];
			if (h.length === 3) {
				return {
					r: parseInt(h.charAt(0) + h.charAt(0), 16),
					g: parseInt(h.charAt(1) + h.charAt(1), 16),
					b: parseInt(h.charAt(2) + h.charAt(2), 16),
				};
			}
			return {
				r: parseInt(h.slice(0, 2), 16),
				g: parseInt(h.slice(2, 4), 16),
				b: parseInt(h.slice(4, 6), 16),
			};
		}
		var rgb = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/i.exec(s);
		if (rgb) {
			return {
				r: clampByte(Number(rgb[1])),
				g: clampByte(Number(rgb[2])),
				b: clampByte(Number(rgb[3])),
			};
		}
		return null;
	}

	function relativeLuminance(r, g, b) {
		function channel(c) {
			var s = c / 255;
			return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
		}
		return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
	}

	function extractAverageColor(imageEl) {
		if (!imageEl || !imageEl.naturalWidth) return null;
		// Modal colour of a thin border ring. Full-frame mode picks large centre
		// artwork; a border mean picks artwork cropped to one edge. Edge + mode
		// keeps the solid surround when it still owns most of the perimeter.
		var size = 48;
		var inset = 3;
		var step = 16;
		var canvas = document.createElement("canvas");
		canvas.width = size;
		canvas.height = size;
		var ctx = canvas.getContext("2d", { willReadFrequently: true });
		if (!ctx) return null;
		try {
			ctx.drawImage(imageEl, 0, 0, size, size);
			var data = ctx.getImageData(0, 0, size, size).data;
			var buckets = Object.create(null);
			var bestKey = null;
			var bestCount = 0;

			function addPixel(x, y, weight) {
				var i = (y * size + x) * 4;
				if (data[i + 3] < 128) return;
				var rq = Math.min(255, Math.floor(data[i] / step) * step);
				var gq = Math.min(255, Math.floor(data[i + 1] / step) * step);
				var bq = Math.min(255, Math.floor(data[i + 2] / step) * step);
				var key = rq + "," + gq + "," + bq;
				var bucket = buckets[key];
				if (!bucket) {
					bucket = buckets[key] = { r: 0, g: 0, b: 0, n: 0 };
				}
				var w = weight || 1;
				bucket.r += data[i] * w;
				bucket.g += data[i + 1] * w;
				bucket.b += data[i + 2] * w;
				bucket.n += w;
				if (bucket.n > bestCount) {
					bestCount = bucket.n;
					bestKey = key;
				}
			}

			for (var y = 0; y < size; y++) {
				for (var x = 0; x < size; x++) {
					var onEdge = x < inset || y < inset || x >= size - inset || y >= size - inset;
					if (!onEdge) continue;
					// Corners are almost always the solid field — weight them up
					// so one cropped edge of artwork can't outvote the surround.
					var inCorner =
						(x < inset || x >= size - inset) && (y < inset || y >= size - inset);
					addPixel(x, y, inCorner ? 3 : 1);
				}
			}

			if (!bestKey || !bestCount) return null;
			var winner = buckets[bestKey];
			return rgbToHex(winner.r / winner.n, winner.g / winner.n, winner.b / winner.n);
		} catch (err) {
			return null;
		}
	}

	function cacheAmbientColor(adjusted, keys) {
		if (!adjusted || !keys) return;
		for (var i = 0; i < keys.length; i++) {
			if (keys[i]) lightboxColorCache[keys[i]] = adjusted;
		}
	}

	function warmLightboxColorCache(img) {
		if (!img || !img.complete || !img.naturalWidth) return;
		var color = extractAverageColor(img);
		if (!color) return;
		var adjusted = darkenCssColor(color, 0.1);
		var keys = [img.currentSrc || img.src];
		if (img.dataset.basePath && img.dataset.filename) {
			var shared = img.dataset.shared === "true";
			keys.push(getThemedSrc(img.dataset.basePath, img.dataset.filename, shared));
			keys.push(img.dataset.basePath + "dark/" + img.dataset.filename);
			keys.push(img.dataset.basePath + img.dataset.filename);
		} else if (img.dataset.filename && img.dataset.src) {
			keys.push(img.dataset.src);
		} else if (img.dataset.filename) {
			/* Photos: src is already the cache key once loaded */
		}
		cacheAmbientColor(adjusted, keys);
	}

	function findGridPreviewImage(filename) {
		if (!filename) return null;
		var nodes = document.querySelectorAll(
			"img.work-image[data-filename], img.photo-image[data-filename]",
		);
		for (var i = 0; i < nodes.length; i++) {
			var candidate = nodes[i];
			if (candidate.dataset.filename !== filename) continue;
			if (candidate.complete && candidate.naturalWidth) return candidate;
		}
		return null;
	}

	function getThemedSrc(basePath, filename, shared) {
		const isLight = document.documentElement.classList.contains("light-mode");
		if (isLight && !shared && !lightImageMissing.has(basePath + filename)) {
			return basePath + "light/" + filename;
		}
		return basePath + "dark/" + filename;
	}

	// Swap all gallery images to match the current theme
	window.updateGalleryTheme = function () {
		document
			.querySelectorAll("img.work-image[data-base-path][data-filename]")
			.forEach(function (img) {
				var basePath = img.dataset.basePath;
				var filename = img.dataset.filename;
				var shared = img.dataset.shared === "true";
				var newSrc = getThemedSrc(basePath, filename, shared);

				if (img.dataset.src) {
					img.dataset.src = newSrc;
				} else if (img.src) {
					img.src = newSrc;
				}
			});
		if (galleryLightboxApi && typeof galleryLightboxApi.refreshTheme === "function") {
			galleryLightboxApi.refreshTheme();
		}
	};

	// Lazy loading with Intersection Observer
	function setupLazyLoading() {
		const imageObserver = new IntersectionObserver(
			function (entries, observer) {
				entries.forEach(function (entry) {
					if (entry.isIntersecting) {
						const img = entry.target;
						if (img.dataset.src) {
							img.src = img.dataset.src;
							img.removeAttribute("data-src");
							observer.unobserve(img);
							if (img.complete && img.naturalWidth) {
								warmLightboxColorCache(img);
							} else {
								img.addEventListener(
									"load",
									function () {
										warmLightboxColorCache(img);
									},
									{ once: true },
								);
							}
						}
					}
				});
			},
			{
				rootMargin: "50px",
			},
		);

		document.querySelectorAll("img[data-src]").forEach(function (img) {
			imageObserver.observe(img);
		});
	}

	// Append text to a parent element, supporting:
	// - "(...)" segments — class from optional third arg (default opacity-50)
	// - "<Name/>" tokens where only "<" and "/>" are opacity-50
	// - "~~...~~" segments rendered with strikethrough
	function appendBracketStyledText(text, parent, parenClass) {
		if (!text) return;
		const parenOpacityClass = parenClass || "opacity-50";
		const tagParts = text.split(/(<[^/]+\/>)/);
		function appendParentheticalText(segmentText, target) {
			const parts = segmentText.split(/(\([^)]*\))/);
			parts.forEach(function (part) {
				if (!part) return;
				const span = document.createElement("span");
				if (part.startsWith("(") && part.endsWith(")")) {
					span.className = parenOpacityClass;
				}
				span.textContent = part;
				target.appendChild(span);
			});
		}

		tagParts.forEach(function (segment) {
			if (!segment) return;
			const tagMatch = segment.match(/^<([^/]+)\/>$/);
			if (tagMatch) {
				const open = document.createElement("span");
				open.className = "opacity-50";
				open.textContent = "<";
				parent.appendChild(open);
				const mid = document.createElement("span");
				mid.textContent = tagMatch[1];
				parent.appendChild(mid);
				const close = document.createElement("span");
				close.className = "opacity-50";
				close.textContent = "/>";
				parent.appendChild(close);
				return;
			}

			const strikeParts = segment.split(/(~~.+?~~)/);
			strikeParts.forEach(function (strikePart) {
				if (!strikePart) return;
				const strikeMatch = strikePart.match(/^~~(.+?)~~$/);
				if (strikeMatch) {
					const deleted = document.createElement("del");
					appendParentheticalText(strikeMatch[1], deleted);
					parent.appendChild(deleted);
					return;
				}
				appendParentheticalText(strikePart, parent);
			});
		});
	}

	// Raw Content-Length in bytes (HEAD), or null
	async function getFileSizeBytes(url) {
		try {
			const response = await fetch(url, { method: "HEAD" });
			const contentLength = response.headers.get("Content-Length");
			if (contentLength) {
				return parseInt(contentLength, 10);
			}
		} catch (error) {
			console.warn("Could not fetch file size for", url);
		}
		return null;
	}

	// Get file size in KB
	async function getFileSize(url) {
		const bytes = await getFileSizeBytes(url);
		if (bytes == null) return null;
		return Math.round(bytes / 1024);
	}

	// e.g. 3mb, 2.4mb, 512kb — lowercase suffix per site copy
	function formatCompactDataSize(bytes) {
		if (bytes == null || bytes <= 0) {
			return null;
		}
		const MB = 1024 * 1024;
		if (bytes >= MB) {
			const x = bytes / MB;
			if (x >= 10) {
				return Math.round(x) + "mb";
			}
			const rounded = Math.round(x * 10) / 10;
			const s = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
			return s.replace(/\.0$/, "") + "mb";
		}
		return Math.max(1, Math.round(bytes / 1024)) + "kb";
	}

	// Optional width/height from JSON; avoids per-tile probe when present.
	function aspectRatioFromJsonDimensions(dims) {
		if (!dims || typeof dims.width !== "number" || typeof dims.height !== "number") {
			return null;
		}
		if (dims.width <= 0 || dims.height <= 0) {
			return null;
		}
		return dims.width / dims.height;
	}

	// Canonical dimensions from dark/ (same pixel size as light/ per site convention)
	function probeWorkImageAspectRatio(basePath, filename) {
		return new Promise(function (resolve) {
			const probe = new Image();
			probe.onload = function () {
				if (this.naturalWidth > 0 && this.naturalHeight > 0) {
					resolve(this.naturalWidth / this.naturalHeight);
				} else {
					resolve(null);
				}
			};
			probe.onerror = function () {
				resolve(null);
			};
			probe.src = basePath + "dark/" + filename;
		});
	}

	// Create an image element with theme-aware src (dark default, optional light variant)
	async function createWorkImage(basePath, filename, altText, dims, shared) {
		let aspectRatio = aspectRatioFromJsonDimensions(dims);
		if (aspectRatio == null) {
			aspectRatio = await probeWorkImageAspectRatio(basePath, filename);
		}

		const frame = document.createElement("div");
		frame.className = "work-image-frame";

		const img = document.createElement("img");
		img.className = "work-image";
		img.dataset.basePath = basePath;
		img.dataset.filename = filename;
		img.dataset.shared = shared ? "true" : "false";
		img.dataset.src = getThemedSrc(basePath, filename, shared);
		img.alt = altText || "";
		img.loading = "lazy";

		if (aspectRatio != null) {
			img.style.aspectRatio = String(aspectRatio);
		}

		img.addEventListener("load", function () {
			this.classList.add("is-loaded");
		});

		img.addEventListener("error", function () {
			var bp = this.dataset.basePath;
			var fn = this.dataset.filename;
			if (!bp || !fn) return;
			var darkSrc = bp + "dark/" + fn;
			if (!shared && this.src && !this.src.endsWith(darkSrc)) {
				lightImageMissing.add(bp + fn);
				this.src = darkSrc;
			}
		});

		frame.appendChild(img);
		return frame;
	}

	// Create an image element for photos (no dark/light theme variants)
	function createPhotoImage(basePath, filename, altText, defaultAspectRatio, dims) {
		const aspectRatio = aspectRatioFromJsonDimensions(dims) || defaultAspectRatio || null;

		const frame = document.createElement("div");
		frame.className = "photo-image-frame";

		const img = document.createElement("img");
		img.className = "photo-image";
		img.dataset.src = basePath + filename;
		img.dataset.filename = filename;
		img.alt = altText || "";
		img.loading = "lazy";

		if (aspectRatio != null) {
			img.style.aspectRatio = String(aspectRatio);
		}

		img.addEventListener("load", function () {
			this.classList.add("is-loaded");
		});

		frame.appendChild(img);
		return frame;
	}

	// Build the "meta" caption line as a <p> with spans inside
	// leftTextClass is e.g. "work-client", "work-number", or "photo-number"
	function buildWorkTextLine(leftText, descriptionText, leftTextClass, descriptionClass) {
		if (!leftText && !descriptionText) return null;

		const metaLine = document.createElement("p");
		metaLine.className = leftTextClass.replace(/-client$|-number$/, "-text");

		if (leftText) {
			const leftSpan = document.createElement("span");
			leftSpan.className = leftTextClass;
			appendBracketStyledText(leftText, leftSpan);
			metaLine.appendChild(leftSpan);
		}

		if (descriptionText) {
			if (leftText) {
				const divider = document.createElement("span");
				divider.className = "opacity-25";
				divider.textContent = " //";
				metaLine.appendChild(divider);
			}
			const description = document.createElement("span");
			description.className = descriptionClass || "work-description";
			appendBracketStyledText(" " + descriptionText, description);
			metaLine.appendChild(description);
		}

		return metaLine;
	}

	// Build filename line <p> with ⌙, path, filename, and optional size
	async function buildFilenameLine(displayPath, displayName, sizeUrl, className) {
		const built = buildFilenameLineElement(displayPath, displayName, className);
		if (sizeUrl) {
			const fileSize = await getFileSize(sizeUrl);
			if (fileSize) {
				built.sizeSpan.textContent = " (" + fileSize + "kb)";
			}
		}
		return built.el;
	}

	/** Sync filename caption line; size span can be filled later to avoid layout flash. */
	function buildFilenameLineElement(displayPath, displayName, className) {
		const filename = document.createElement("p");
		filename.className = className || "work-filename";

		const corner = document.createElement("span");
		corner.className = "opacity-15";
		corner.innerHTML = "&#8985;";

		const pathSpan = document.createElement("span");
		pathSpan.className = "opacity-25";
		pathSpan.textContent = displayPath;

		const nameSpan = document.createElement("span");
		nameSpan.className = "opacity-25";
		nameSpan.textContent = displayName;

		const sizeSpan = document.createElement("span");
		sizeSpan.className = "opacity-15";

		filename.appendChild(corner);
		filename.appendChild(document.createTextNode(" "));
		filename.appendChild(pathSpan);
		filename.appendChild(nameSpan);
		filename.appendChild(document.createTextNode(" "));
		filename.appendChild(sizeSpan);

		return { el: filename, sizeSpan: sizeSpan };
	}

	// Optional work item URL: normalized href + host/path for caption after [URL]
	function normalizeWorkLink(link) {
		if (!link || typeof link !== "string") return null;
		const t = link.trim();
		if (!t) return null;
		let href = t;
		if (!/^https?:\/\//i.test(t)) {
			href = "https://" + t;
		}
		const m = href.match(/^https?:\/\/(.+)$/i);
		if (!m) return null;
		return { href, rest: m[1] };
	}

	function appendLinkCaptionParts(anchor, rest) {
		const label = document.createElement("span");
		label.className = "opacity-25";
		label.textContent = "[URL]";
		anchor.appendChild(label);
		anchor.appendChild(document.createTextNode(" "));
		anchor.appendChild(document.createTextNode(rest));
	}

	function buildWorkLinkLine(link, linkDisplay) {
		const parsed = normalizeWorkLink(link);
		if (!parsed) return null;

		const p = document.createElement("p");
		p.className = "work-link";

		const a = document.createElement("a");
		a.href = parsed.href;
		a.target = "_blank";
		a.rel = "noopener noreferrer";

		const displayRaw =
			linkDisplay && typeof linkDisplay === "string" && linkDisplay.trim()
				? linkDisplay.trim()
				: null;

		if (displayRaw) {
			const displayParsed = normalizeWorkLink(displayRaw);
			if (displayParsed) {
				appendLinkCaptionParts(a, displayParsed.rest);
			} else {
				a.appendChild(document.createTextNode(displayRaw));
			}
		} else {
			appendLinkCaptionParts(a, parsed.rest);
		}

		const arrow = document.createElement("span");
		arrow.className = "opacity-50";
		arrow.textContent = " →";
		a.appendChild(arrow);

		p.appendChild(a);
		return p;
	}

	function appendWorkSlashDivider(paragraph) {
		const slash = document.createElement("span");
		slash.className = "opacity-25";
		slash.textContent = " //";
		paragraph.appendChild(slash);
	}

	/** Keep new tiles above the load-more sentinel (divider + row live at end of .work-grid / .photo-grid). */
	function appendGalleryNode(container, node) {
		const sent = container._insertBeforeLoadMore;
		if (sent && sent.parentNode === container) {
			container.insertBefore(node, sent);
		} else {
			container.appendChild(node);
		}
	}

	const WORK_CREDITS_FIELD_ORDER = [
		["client", "Client"],
		["creativeDirection", "Creative Direction"],
		["design", "Design"],
		["development", "Development"],
		["research", "Research"],
		["content", "Content"],
		["collaborators", "Collaborators"],
	];

	const WORK_DETAILS_FIELD_ORDER = [
		["formats", "Formats"],
		["fonts", "Fonts"],
	];

	function formatWorkCreditsValue(val) {
		if (val == null || val === "") return "";
		if (Array.isArray(val)) {
			return val
				.map(function (x) {
					return x == null ? "" : String(x);
				})
				.filter(Boolean)
				.join(", ");
		}
		return String(val);
	}

	function appendWorkCreditsRow(container, label, rawVal) {
		const text = formatWorkCreditsValue(rawVal);
		if (!text) return;

		const p = document.createElement("p");
		p.className = "work-info-line";

		const lab = document.createElement("span");
		lab.className = "opacity-25";
		lab.textContent = label + ": ";

		const valSpan = document.createElement("span");
		valSpan.className = "opacity-50";
		appendBracketStyledText(text, valSpan, "opacity-25");

		p.appendChild(lab);
		p.appendChild(valSpan);
		container.appendChild(p);
	}

	// Project credits + optional details (graphics: type "info") — typography matches .work-filename lines
	function renderGraphicsCreditsItem(item, container) {
		const creditsObj = item.credits && typeof item.credits === "object" ? item.credits : {};
		const detailsObj = item.details && typeof item.details === "object" ? item.details : {};

		let anyCredits = false;
		for (let i = 0; i < WORK_CREDITS_FIELD_ORDER.length; i++) {
			const key = WORK_CREDITS_FIELD_ORDER[i][0];
			if (formatWorkCreditsValue(creditsObj[key])) {
				anyCredits = true;
				break;
			}
		}
		let anyDetails = false;
		for (let j = 0; j < WORK_DETAILS_FIELD_ORDER.length; j++) {
			const dkey = WORK_DETAILS_FIELD_ORDER[j][0];
			if (formatWorkCreditsValue(detailsObj[dkey])) {
				anyDetails = true;
				break;
			}
		}

		if (!anyCredits && !anyDetails) return;

		const wrap = document.createElement("div");
		wrap.className = "work-info-block";
		if (item.project) {
			wrap.setAttribute("data-project", item.project);
		}

		const creditsBlock = document.createElement("div");
		creditsBlock.className = "work-info-credits";
		for (let c = 0; c < WORK_CREDITS_FIELD_ORDER.length; c++) {
			const pair = WORK_CREDITS_FIELD_ORDER[c];
			appendWorkCreditsRow(creditsBlock, pair[1], creditsObj[pair[0]]);
		}
		if (creditsBlock.childNodes.length > 0) {
			wrap.appendChild(creditsBlock);
		}

		if (anyDetails) {
			const detailsBlock = document.createElement("div");
			detailsBlock.className = "work-info-details";
			for (let d = 0; d < WORK_DETAILS_FIELD_ORDER.length; d++) {
				const dpair = WORK_DETAILS_FIELD_ORDER[d];
				appendWorkCreditsRow(detailsBlock, dpair[1], detailsObj[dpair[0]]);
			}
			if (detailsBlock.childNodes.length > 0) {
				wrap.appendChild(detailsBlock);
			}
		}

		if (wrap.childNodes.length > 0) {
			appendGalleryNode(container, wrap);
		}
	}

	// Full-width section title (graphics: type "title")
	function renderGraphicsTitleItem(item, container) {
		const wrap = document.createElement("div");
		wrap.className = "work-grid-title";
		if (item.project) {
			wrap.setAttribute("data-project", item.project);
		}

		const line = document.createElement("p");
		line.className = "work-text work-title-line";

		if (item.name) {
			const nameSpan = document.createElement("span");
			nameSpan.className = "work-title-name";
			appendBracketStyledText(item.name, nameSpan);
			line.appendChild(nameSpan);
		}

		if (item.date) {
			if (line.childNodes.length > 0) {
				line.appendChild(document.createTextNode(" "));
			}
			const dateSpan = document.createElement("span");
			dateSpan.className = "opacity-75";
			appendBracketStyledText(item.date, dateSpan);
			line.appendChild(dateSpan);
		}

		if (item.description) {
			if (line.childNodes.length > 0) {
				appendWorkSlashDivider(line);
			}
			const descSpan = document.createElement("span");
			descSpan.className = "work-description";
			appendBracketStyledText(" " + item.description, descSpan);
			line.appendChild(descSpan);
		}

		if (line.childNodes.length > 0) {
			wrap.appendChild(line);
		}

		const linkEl = buildWorkLinkLine(item.link, item.linkDisplay);
		if (linkEl) {
			wrap.appendChild(linkEl);
		}

		if (wrap.childNodes.length > 0) {
			appendGalleryNode(container, wrap);
		}
	}

	// =========================================================================
	// GRAPHICS RENDERER
	// =========================================================================

	async function renderGraphicsItem(item, container) {
		if (item.divider) {
			const hr = document.createElement("hr");
			hr.className = "divider work-grid-divider";
			hr.setAttribute("aria-hidden", "true");
			if (item.project) {
				hr.setAttribute("data-project", item.project);
			}
			appendGalleryNode(container, hr);
			return;
		}

		if (item.type === "title") {
			renderGraphicsTitleItem(item, container);
			return;
		}

		if (item.type === "info") {
			renderGraphicsCreditsItem(item, container);
			return;
		}

		const workItem = document.createElement("div");
		workItem.className = "work-item";
		const columns = item.columns && [1, 2, 3, 4].includes(item.columns) ? item.columns : 1;
		workItem.setAttribute("data-columns", columns);
		if (item.project) {
			workItem.setAttribute("data-project", item.project);
		}

		const graphicsLabel = item.number != null && item.number !== "" ? String(item.number) : "";

		if (item.filename) {
			let altText = "";
			if (graphicsLabel && item.description) {
				altText = graphicsLabel + " - " + item.description;
			} else if (graphicsLabel) {
				altText = graphicsLabel;
			} else if (item.description) {
				altText = item.description;
			} else {
				altText = item.filename;
			}
			const frame = await createWorkImage(
				"/filing/v5/work/",
				item.filename,
				altText,
				item,
				item.shared === true,
			);
			workItem.appendChild(frame);
		}

		const caption = document.createElement("div");
		caption.className = "work-caption";

		const metaLine = buildWorkTextLine(
			graphicsLabel,
			item.description,
			"work-number",
			"work-description",
		);
		if (metaLine && metaLine.childNodes.length > 0) {
			caption.appendChild(metaLine);
		}

		if (item.filename) {
			const fileToShow = item.filename;
			const sizeUrl = "/filing/v5/work/dark/" + fileToShow;
			buildFilenameLine("/filing/work/", fileToShow, sizeUrl, "work-filename").then(
				function (filenameEl) {
					caption.appendChild(filenameEl);
					const linkEl = buildWorkLinkLine(item.link, item.linkDisplay);
					if (linkEl) caption.appendChild(linkEl);
				},
			);
		}

		workItem.appendChild(caption);
		appendGalleryNode(container, workItem);
	}

	// =========================================================================
	// PHOTO RENDERER
	// =========================================================================

	function buildPhotoMetaLine(item) {
		if (!item.camera && !item.focalLength && !item.shutterSpeed && !item.aperture) return null;

		const p = document.createElement("p");
		p.className = "photo-meta";

		if (item.camera) {
			const cameraSpan = document.createElement("span");
			cameraSpan.textContent = item.camera;
			p.appendChild(cameraSpan);
		}

		const exif = [];
		if (item.focalLength) exif.push(item.focalLength);
		if (item.shutterSpeed) exif.push(item.shutterSpeed);
		if (item.aperture) exif.push(item.aperture);
		if (item.iso) exif.push(item.iso);

		if (exif.length > 0) {
			const wrap = document.createElement("span");
			wrap.className = "opacity-25";
			wrap.textContent = (item.camera ? " (" : "(") + exif.join(" ~ ") + ")";
			p.appendChild(wrap);
		}

		return p;
	}

	function renderPhotoItem(item, container, config) {
		const photoItem = document.createElement("div");
		photoItem.className = "photo-item";
		const columns = item.columns && [1, 2, 3, 4].includes(item.columns) ? item.columns : 1;
		photoItem.setAttribute("data-columns", columns);

		if (item.category) {
			photoItem.setAttribute("data-category", item.category);
		}
		if (item.tone) {
			photoItem.setAttribute("data-tone", item.tone);
		}
		if (item.tags && item.tags.length > 0) {
			photoItem.setAttribute("data-tags", item.tags.join(","));
		}

		const photoLabel = item.number != null && item.number !== "" ? String(item.number) : "";

		if (item.filename) {
			const altText = item.alt || item.description || item.filename;
			const frame = createPhotoImage(
				config.imageBasePath,
				item.filename,
				altText,
				config.defaultAspectRatio,
				item,
			);
			photoItem.appendChild(frame);
		}

		const caption = document.createElement("div");
		caption.className = "photo-caption";

		const metaLine = buildWorkTextLine(
			photoLabel,
			item.description,
			"photo-number",
			"photo-description",
		);
		if (metaLine && metaLine.childNodes.length > 0) {
			caption.appendChild(metaLine);
		}

		const exifLine = buildPhotoMetaLine(item);
		if (exifLine) {
			caption.appendChild(exifLine);
		}

		if (item.filename) {
			const sizeUrl = config.imageBasePath + item.filename;
			buildFilenameLine("/filing/v5/photos/", item.filename, sizeUrl, "photo-filename").then(
				function (filenameEl) {
					caption.appendChild(filenameEl);
				},
			);
		}

		photoItem.appendChild(caption);
		appendGalleryNode(container, photoItem);
	}

	// =========================================================================
	// FILTER BAR
	// =========================================================================

	function createGraphicsPortfolioMeta() {
		const wrap = document.createElement("span");
		wrap.className = "filter-bar-active-meta filter-bar-portfolio-meta";

		const prefix = document.createElement("span");
		prefix.className = "opacity-25";
		prefix.textContent = "Currently: ";
		wrap.appendChild(prefix);

		const a = document.createElement("a");
		a.href = "https://daas.graphics";
		a.target = "_blank";
		a.rel = "noopener noreferrer";

		const name = document.createElement("span");
		name.className = "opacity-75";
		name.textContent = "DaaS";
		a.appendChild(name);

		const role = document.createElement("span");
		role.className = "opacity-25";
		role.textContent = " (Graphics)";
		a.appendChild(role);

		wrap.appendChild(a);

		const slash = document.createElement("span");
		slash.className = "opacity-15";
		slash.setAttribute("aria-hidden", "true");
		slash.textContent = " / ";
		wrap.appendChild(slash);

		const period = document.createElement("span");
		period.className = "opacity-25";
		period.textContent = "2025—Present";
		wrap.appendChild(period);

		return wrap;
	}

	/* One bar, three presentations (CSS toggles which DOM is visible):
	   — >1640px: inline locations + tags (+ More) + tone; mobile row hidden.
	   — 1081–1640px: same locations; tags+tone as dropdowns in .filter-bar-desktop-narrow-cluster; wide lists hidden.
	   — ≤1080px: .filter-bar-mobile dropdowns; desktop nav hidden; tone dropdown hidden on small row.
	   State: activeCategory / activeTone / activeTag + buildDropdown + updateActiveStates + fireFilter. */
	function buildPhotoFilterBar(allItems, onFilter) {
		/* Inline tag cap for the wide desktop row (see CSS): 10 only above 2660px; 5 from 1641–2660
		   (matches “wide desktop” body band) and ≤1640 (row hidden; cap kept for resize). Sync 2661/1641 with styles.css. */
		const PHOTO_DESKTOP_TAGS_INLINE_MAX_ULTRA = 10;
		const PHOTO_DESKTOP_TAGS_INLINE_MAX_DEFAULT = 5;

		const categories = [];
		const catSeen = new Set();
		const tags = [];
		const tagSeen = new Set();
		for (let i = 0; i < allItems.length; i++) {
			const cat = allItems[i].category;
			if (cat && !catSeen.has(cat)) {
				catSeen.add(cat);
				categories.push(cat);
			}
			if (allItems[i].tags) {
				for (let t = 0; t < allItems[i].tags.length; t++) {
					const tag = allItems[i].tags[t];
					if (tag && !tagSeen.has(tag)) {
						tagSeen.add(tag);
						tags.push(tag);
					}
				}
			}
		}

		var tagsDesktopInline = [];
		var tagsDesktopOverflow = [];

		const hasBW = allItems.some(function (it) {
			return it.tone === "noir";
		});
		const hasColour = allItems.some(function (it) {
			return it.tone === "colour";
		});
		const hasTones = hasBW && hasColour;
		const hasTags = tags.length > 0;

		if (categories.length <= 1 && !hasTones && !hasTags) return null;

		const bar = document.createElement("div");
		bar.className = "filter-bar";

		let activeCategory = null;
		var mqlMobileLayout = window.matchMedia(FILTER_BAR_MOBILE_MQL);
		var mqlDesktopNarrowFilters = window.matchMedia("(max-width: 1640px) and (min-width: 1081px)");
		var isMobileFilter = mqlMobileLayout.matches;
		/* Inline Noir/Colour (wide desktop only) defaults to noir; tone as dropdown = All (null). */
		var toneInDropdownDesktop = hasTones && !isMobileFilter && mqlDesktopNarrowFilters.matches;
		let activeTone = null;
		if (hasTones && !isMobileFilter && !toneInDropdownDesktop) {
			activeTone = hasBW ? "noir" : null;
		}
		let activeTag = null;

		function fireFilter() {
			onFilter(activeCategory, activeTone, activeTag);
		}

		function updateActiveStates() {
			bar.querySelectorAll("[data-filter-category]").forEach(function (btn) {
				const val = btn.getAttribute("data-filter-category");
				btn.classList.toggle("is-active", val === (activeCategory || "all"));
			});
			bar.querySelectorAll("[data-filter-tone]").forEach(function (btn) {
				const val = btn.getAttribute("data-filter-tone");
				btn.classList.toggle("is-active", val === activeTone);
			});
			bar.querySelectorAll("[data-filter-tag]").forEach(function (btn) {
				const val = btn.getAttribute("data-filter-tag");
				btn.classList.toggle("is-active", val === activeTag);
			});
			var tagMoreWrap = bar.querySelector(".filter-bar-tag-more");
			if (tagMoreWrap) {
				tagMoreWrap.classList.toggle(
					"has-selection",
					Boolean(activeTag && tagsDesktopOverflow.indexOf(activeTag) !== -1),
				);
			}
		}

		// Category buttons
		function appendParenStyledText(text, parent, parenClass) {
			var parts = text.split(/(\([^)]*\))/);
			for (var i = 0; i < parts.length; i++) {
				if (!parts[i]) continue;
				var span = document.createElement("span");
				if (parts[i].startsWith("(") && parts[i].endsWith(")")) {
					span.className = parenClass;
				}
				span.textContent = parts[i];
				parent.appendChild(span);
			}
		}

		function addListLabel(ul, text) {
			const li = document.createElement("li");
			const span = document.createElement("span");
			span.className = "opacity-25";
			span.textContent = text;
			li.appendChild(span);
			ul.appendChild(li);
		}

		function addSlashLi(ul) {
			const li = document.createElement("li");
			li.className = "opacity-15";
			li.setAttribute("aria-hidden", "true");
			li.textContent = "/";
			ul.appendChild(li);
		}

		function addCatBtn(ul, label, value) {
			const li = document.createElement("li");
			const btn = document.createElement("button");
			btn.setAttribute("data-filter-category", value);
			appendParenStyledText(label, btn, "opacity-25");

			btn.addEventListener("click", function () {
				activeCategory = value === "all" ? null : value;
				updateActiveStates();
				fireFilter();
			});
			li.appendChild(btn);
			ul.appendChild(li);
		}

		var tagOptionsAll = null;
		if (hasTags) {
			tagOptionsAll = [{ label: "All", value: "all" }];
			for (var tix = 0; tix < tags.length; tix++) {
				tagOptionsAll.push({ label: tags[tix], value: tags[tix] });
			}
		}
		var toneOptionsAll = null;
		if (hasTones) {
			toneOptionsAll = [
				{ label: "All", value: "all" },
				{ label: "Noir", value: "noir" },
				{ label: "Colour", value: "colour" },
			];
		}

		function buildDropdown(label, options, getActive, setActive, filterDataAttr) {
			const wrapper = document.createElement("div");
			wrapper.className = "filter-dropdown";

			const trigger = document.createElement("button");
			trigger.className = "filter-dropdown-trigger";

			const triggerLabel = document.createElement("span");
			triggerLabel.textContent = label;
			trigger.appendChild(triggerLabel);

			const chevron = document.createElement("span");
			chevron.className = "opacity-25";
			chevron.textContent = " ▾";
			trigger.appendChild(chevron);

			const list = document.createElement("div");
			list.className = "filter-dropdown-list";

			function updateTriggerLabel() {
				var active = getActive();
				var defaultVal = options.length > 0 ? options[0].value : null;
				if (active && active !== defaultVal) {
					var match = options.find(function (o) {
						return o.value === active;
					});
					triggerLabel.textContent = match ? match.shortLabel || match.label : active;
					wrapper.classList.add("has-selection");
				} else {
					triggerLabel.textContent = label;
					wrapper.classList.remove("has-selection");
				}
			}

			function buildList() {
				list.innerHTML = "";
				var active = getActive();
				for (var i = 0; i < options.length; i++) {
					var opt = document.createElement("button");
					opt.className = "filter-dropdown-option";
					opt.setAttribute("data-value", options[i].value);
					if (filterDataAttr && options[i].value !== "all") {
						opt.setAttribute(filterDataAttr, options[i].value);
					}
					if (options[i].styledLabel) {
						appendParenStyledText(options[i].styledLabel, opt, "opacity-25");
					} else {
						opt.textContent = options[i].label;
					}
					if (options[i].value === active) opt.classList.add("is-active");
					(function (val) {
						opt.addEventListener("click", function (e) {
							e.stopPropagation();
							setActive(val);
							updateActiveStates();
							fireFilter();
							updateTriggerLabel();
							wrapper.classList.remove("is-open");
						});
					})(options[i].value);
					list.appendChild(opt);
				}
			}

			trigger.addEventListener("click", function (e) {
				e.stopPropagation();
				var wasOpen = wrapper.classList.contains("is-open");
				bar.querySelectorAll(".filter-dropdown.is-open").forEach(function (d) {
					d.classList.remove("is-open");
				});
				if (!wasOpen) {
					buildList();
					wrapper.classList.add("is-open");
				}
			});

			wrapper.appendChild(trigger);
			wrapper.appendChild(list);
			updateTriggerLabel();
			return wrapper;
		}

		const desktopWrap = document.createElement("nav");
		desktopWrap.className = "filter-bar-desktop";
		desktopWrap.setAttribute("aria-label", "Photo filters");

		const locationsUl = document.createElement("ul");
		locationsUl.className = "filter-bar-list";
		addListLabel(locationsUl, "Locations:");
		addCatBtn(locationsUl, "All", "all");
		for (let i = 0; i < categories.length; i++) {
			addSlashLi(locationsUl);
			addCatBtn(locationsUl, categories[i], categories[i]);
		}
		desktopWrap.appendChild(locationsUl);

		if (hasTags || hasTones) {
			const groupsWrap = document.createElement("div");
			groupsWrap.className = "filter-bar-groups";

			const narrowCluster = document.createElement("div");
			narrowCluster.className = "filter-bar-desktop-narrow-cluster";
			const narrowLabel = document.createElement("span");
			narrowLabel.className = "opacity-25";
			narrowLabel.textContent = "Filters:";
			narrowCluster.appendChild(narrowLabel);

			var tagsNarrowWrap = null;
			var toneNarrowWrap = null;

			if (hasTags) {
				var mqlDesktopWideTags = window.matchMedia("(min-width: 1641px)");
				var mqlUltraWideTags = window.matchMedia("(min-width: 2661px)");

				function desktopTagsInlineMax() {
					if (!mqlDesktopWideTags.matches) {
						return PHOTO_DESKTOP_TAGS_INLINE_MAX_DEFAULT;
					}
					return mqlUltraWideTags.matches
						? PHOTO_DESKTOP_TAGS_INLINE_MAX_ULTRA
						: PHOTO_DESKTOP_TAGS_INLINE_MAX_DEFAULT;
				}

				function partitionDesktopTags() {
					var max = desktopTagsInlineMax();
					if (tags.length <= max) {
						tagsDesktopInline = tags.slice();
						tagsDesktopOverflow = [];
					} else {
						tagsDesktopInline = tags.slice(0, max);
						tagsDesktopOverflow = tags.slice(max);
					}
				}

				partitionDesktopTags();

				function buildWideTagsUl() {
					const tagsUl = document.createElement("ul");
					tagsUl.className = "filter-bar-list filter-bar-tags filter-bar-tags-wide";
					addListLabel(tagsUl, "Tags:");
					for (let ti = 0; ti < tagsDesktopInline.length; ti++) {
						if (ti > 0) {
							addSlashLi(tagsUl);
						}
						const li = document.createElement("li");
						const btn = document.createElement("button");
						btn.setAttribute("data-filter-tag", tagsDesktopInline[ti]);
						btn.textContent = tagsDesktopInline[ti];
						(function (tagVal) {
							btn.addEventListener("click", function () {
								activeTag = activeTag === tagVal ? null : tagVal;
								updateActiveStates();
								fireFilter();
							});
						})(tagsDesktopInline[ti]);
						li.appendChild(btn);
						tagsUl.appendChild(li);
					}
					if (tagsDesktopOverflow.length > 0) {
						addSlashLi(tagsUl);
						const moreLi = document.createElement("li");
						const moreWrap = document.createElement("div");
						moreWrap.className = "filter-bar-tag-more filter-dropdown";
						const moreTrigger = document.createElement("button");
						moreTrigger.type = "button";
						moreTrigger.className = "filter-dropdown-trigger";
						moreTrigger.setAttribute("aria-haspopup", "true");
						moreTrigger.setAttribute("aria-expanded", "false");
						const moreLabel = document.createElement("span");
						moreLabel.textContent = "More";
						moreTrigger.appendChild(moreLabel);
						const moreChev = document.createElement("span");
						moreChev.className = "opacity-25";
						moreChev.textContent = " ▾";
						moreTrigger.appendChild(moreChev);
						const moreList = document.createElement("div");
						moreList.className = "filter-dropdown-list";
						function rebuildMoreTagList() {
							moreList.innerHTML = "";
							for (let oi = 0; oi < tagsDesktopOverflow.length; oi++) {
								const opt = document.createElement("button");
								opt.type = "button";
								opt.className = "filter-dropdown-option";
								opt.setAttribute("data-filter-tag", tagsDesktopOverflow[oi]);
								opt.textContent = tagsDesktopOverflow[oi];
								(function (tagVal) {
									opt.addEventListener("click", function (e) {
										e.stopPropagation();
										activeTag = activeTag === tagVal ? null : tagVal;
										updateActiveStates();
										fireFilter();
										moreWrap.classList.remove("is-open");
										moreTrigger.setAttribute("aria-expanded", "false");
									});
								})(tagsDesktopOverflow[oi]);
								moreList.appendChild(opt);
							}
						}
						moreTrigger.addEventListener("click", function (e) {
							e.stopPropagation();
							var wasOpen = moreWrap.classList.contains("is-open");
							bar.querySelectorAll(".filter-dropdown.is-open").forEach(function (d) {
								d.classList.remove("is-open");
							});
							if (!wasOpen) {
								rebuildMoreTagList();
								moreList.querySelectorAll("[data-filter-tag]").forEach(function (b) {
									b.classList.toggle("is-active", b.getAttribute("data-filter-tag") === activeTag);
								});
								moreWrap.classList.add("is-open");
								moreTrigger.setAttribute("aria-expanded", "true");
							} else {
								moreTrigger.setAttribute("aria-expanded", "false");
							}
						});
						moreWrap.appendChild(moreTrigger);
						moreWrap.appendChild(moreList);
						moreLi.appendChild(moreWrap);
						tagsUl.appendChild(moreLi);
					}
					return tagsUl;
				}

				var tagsUlWide = buildWideTagsUl();
				groupsWrap.appendChild(tagsUlWide);

				function syncWideTagsPartitionFromViewport() {
					partitionDesktopTags();
					var nextUl = buildWideTagsUl();
					groupsWrap.replaceChild(nextUl, tagsUlWide);
					tagsUlWide = nextUl;
					updateActiveStates();
				}

				mqlDesktopWideTags.addEventListener("change", syncWideTagsPartitionFromViewport);
				mqlUltraWideTags.addEventListener("change", syncWideTagsPartitionFromViewport);

				tagsNarrowWrap = document.createElement("div");
				tagsNarrowWrap.className = "filter-bar-tags-narrow";
				tagsNarrowWrap.appendChild(
					buildDropdown(
						"Tags",
						tagOptionsAll,
						function () {
							return activeTag || "all";
						},
						function (val) {
							activeTag = val === "all" ? null : val;
						},
						"data-filter-tag",
					),
				);
			}

			if (hasTones) {
				const toneUl = document.createElement("ul");
				toneUl.className = "filter-bar-list filter-bar-tone filter-bar-tone-wide";
				addListLabel(toneUl, "Tone:");

				function addToneLi(label, value, hint) {
					const li = document.createElement("li");
					const btn = document.createElement("button");
					btn.setAttribute("data-filter-tone", value);
					btn.textContent = label;
					if (hint) {
						const hintSpan = document.createElement("span");
						hintSpan.className = "opacity-25";
						hintSpan.textContent = " (" + hint + ")";
						btn.appendChild(hintSpan);
					}
					btn.addEventListener("click", function () {
						activeTone = activeTone === value ? null : value;
						updateActiveStates();
						fireFilter();
					});
					li.appendChild(btn);
					toneUl.appendChild(li);
				}

				addToneLi("Noir", "noir", "Acros");
				addSlashLi(toneUl);
				addToneLi("Colour", "colour", "Various");
				groupsWrap.appendChild(toneUl);

				toneNarrowWrap = document.createElement("div");
				toneNarrowWrap.className = "filter-bar-tone-narrow";
				toneNarrowWrap.appendChild(
					buildDropdown(
						"Tone",
						toneOptionsAll,
						function () {
							return activeTone || "all";
						},
						function (val) {
							activeTone = val === "all" ? null : val;
						},
						"data-filter-tone",
					),
				);
			}

			if (hasTags && tagsNarrowWrap) {
				narrowCluster.appendChild(tagsNarrowWrap);
			}
			if (hasTones && toneNarrowWrap) {
				narrowCluster.appendChild(toneNarrowWrap);
			}

			groupsWrap.appendChild(narrowCluster);
			desktopWrap.appendChild(groupsWrap);
		}

		bar.appendChild(desktopWrap);

		updateActiveStates();

		// Mobile dropdown filter bar
		const mobileBar = document.createElement("div");
		mobileBar.className = "filter-bar-mobile";

		const mobileLabel = document.createElement("span");
		mobileLabel.className = "filter-bar-mobile-label opacity-25";
		mobileLabel.textContent = "Filters:";
		mobileBar.appendChild(mobileLabel);

		var catOptions = [{ label: "All", value: "all" }];
		for (var ci = 0; ci < categories.length; ci++) {
			catOptions.push({
				label: categories[ci],
				styledLabel: categories[ci],
				shortLabel: categories[ci].replace(/\s*\([^)]*\)/, ""),
				value: categories[ci],
			});
		}
		mobileBar.appendChild(
			buildDropdown(
				"Locations",
				catOptions,
				function () {
					return activeCategory || "all";
				},
				function (val) {
					activeCategory = val === "all" ? null : val;
				},
			),
		);

		if (hasTags) {
			var tagDropdown = buildDropdown(
				"Tags",
				tagOptionsAll,
				function () {
					return activeTag || "all";
				},
				function (val) {
					activeTag = val === "all" ? null : val;
				},
				"data-filter-tag",
			);
			mobileBar.appendChild(tagDropdown);
		}

		if (hasTones) {
			var toneDropdown = buildDropdown(
				"Tone",
				toneOptionsAll,
				function () {
					return activeTone || "all";
				},
				function (val) {
					activeTone = val === "all" ? null : val;
				},
				"data-filter-tone",
			);
			toneDropdown.classList.add("filter-dropdown-tone");
			mobileBar.appendChild(toneDropdown);
		}

		document.addEventListener("click", function () {
			bar.querySelectorAll(".filter-dropdown.is-open").forEach(function (d) {
				d.classList.remove("is-open");
			});
			bar
				.querySelectorAll('.filter-bar-tag-more .filter-dropdown-trigger[aria-expanded="true"]')
				.forEach(function (t) {
					t.setAttribute("aria-expanded", "false");
				});
		});

		bar.appendChild(mobileBar);

		bar._fireInitialFilter = function () {
			fireFilter();
		};
		return bar;
	}

	function assignWorkProjects(items) {
		let proj = null;
		let projDate = null;
		for (let i = 0; i < items.length; i++) {
			const it = items[i];
			if (it.type === "title" && it.name) {
				proj = it.name;
				projDate = it.date || null;
			}
			it.project = proj;
			it.projectDate = projDate;
		}
	}

	/** Filter UI label; canonical names in JSON stay full for data-project matching. */
	function graphicsProjectListLabel(canonicalName) {
		if (!canonicalName) return "";
		return canonicalName.replace(/,\s*Inc\.\s*$/i, "").trim();
	}

	/* Desktop: Projects: All / …; mobile: Projects: + Projects dropdown — reuses .filter-bar CSS. */
	function buildGraphicsProjectFilterBar(projectNames, projectImageCounts, onProjectChange) {
		if (!projectNames || projectNames.length <= 1) return null;

		const bar = document.createElement("div");
		bar.className = "filter-bar";

		var mqlGraphicsMobileTrigger = window.matchMedia(FILTER_BAR_MOBILE_MQL);

		let activeProject = null;

		function fireFilter() {
			onProjectChange(activeProject);
		}

		function selectProject(projectName) {
			activeProject = projectName || null;
			updateActiveStates();
			bar.querySelectorAll(".filter-dropdown").forEach(function (d) {
				if (typeof d.updateTriggerLabel === "function") {
					d.updateTriggerLabel();
				}
			});
			fireFilter();
		}

		bar._selectProject = selectProject;

		function updateActiveStates() {
			bar.querySelectorAll("[data-filter-project]").forEach(function (btn) {
				const val = btn.getAttribute("data-filter-project");
				btn.classList.toggle("is-active", val === (activeProject || "all"));
			});
		}

		function appendParenStyledTextPlain(text, parent, parenClass) {
			var parts = text.split(/(\([^)]*\))/);
			for (var i = 0; i < parts.length; i++) {
				if (!parts[i]) continue;
				var span = document.createElement("span");
				if (parts[i].startsWith("(") && parts[i].endsWith(")")) {
					span.className = parenClass;
				}
				span.textContent = parts[i];
				parent.appendChild(span);
			}
		}

		function addListLabel(ul, text) {
			const li = document.createElement("li");
			const span = document.createElement("span");
			span.className = "opacity-25";
			span.textContent = text;
			li.appendChild(span);
			ul.appendChild(li);
		}

		function addSlashLi(ul) {
			const li = document.createElement("li");
			li.className = "opacity-15";
			li.setAttribute("aria-hidden", "true");
			li.textContent = "/";
			ul.appendChild(li);
		}

		function appendProjectFilterLabel(parent, displayLabel, imageCount) {
			appendParenStyledTextPlain(displayLabel, parent, "opacity-25");
			if (typeof imageCount === "number") {
				var supEl = document.createElement("sup");
				supEl.className = "opacity-25";
				supEl.textContent = "(" + imageCount + ")";
				parent.appendChild(supEl);
			}
		}

		function addProjectBtn(ul, label, value, imageCount) {
			const li = document.createElement("li");
			const btn = document.createElement("button");
			btn.type = "button";
			btn.setAttribute("data-filter-project", value);
			if (value === "all") {
				appendParenStyledTextPlain(label, btn, "opacity-25");
			} else {
				appendProjectFilterLabel(btn, label, imageCount);
			}
			btn.addEventListener("click", function () {
				activeProject = value === "all" ? null : value;
				updateActiveStates();
				fireFilter();
			});
			li.appendChild(btn);
			ul.appendChild(li);
		}

		function buildDropdown(label, options, getActive, setActive) {
			const wrapper = document.createElement("div");
			wrapper.className = "filter-dropdown";

			const trigger = document.createElement("button");
			trigger.type = "button";
			trigger.className = "filter-dropdown-trigger";

			const triggerLabel = document.createElement("span");
			triggerLabel.textContent = label;
			trigger.appendChild(triggerLabel);

			const chevron = document.createElement("span");
			chevron.className = "opacity-25";
			chevron.textContent = " ▾";
			trigger.appendChild(chevron);

			const list = document.createElement("div");
			list.className = "filter-dropdown-list";

			function updateTriggerLabel() {
				var active = getActive();
				var defaultVal = options.length > 0 ? options[0].value : null;
				triggerLabel.replaceChildren();
				if (active && active !== defaultVal) {
					var match = null;
					for (var mi = 0; mi < options.length; mi++) {
						if (options[mi].value === active) {
							match = options[mi];
							break;
						}
					}
					if (match) {
						var tl = match.shortLabel || match.label;
						var showSupOnTrigger =
							typeof match.imageCount === "number" && !mqlGraphicsMobileTrigger.matches;
						if (showSupOnTrigger) {
							appendProjectFilterLabel(triggerLabel, tl, match.imageCount);
						} else {
							appendParenStyledTextPlain(tl, triggerLabel, "opacity-25");
						}
					} else {
						triggerLabel.textContent = active;
					}
					wrapper.classList.add("has-selection");
				} else {
					triggerLabel.textContent = label;
					wrapper.classList.remove("has-selection");
				}
			}

			function buildList() {
				list.innerHTML = "";
				var active = getActive();
				for (var i = 0; i < options.length; i++) {
					var opt = document.createElement("button");
					opt.type = "button";
					opt.className = "filter-dropdown-option";
					opt.setAttribute("data-value", options[i].value);
					if (typeof options[i].imageCount === "number" && options[i].styledLabel) {
						appendProjectFilterLabel(opt, options[i].styledLabel, options[i].imageCount);
					} else if (options[i].styledLabel) {
						appendParenStyledTextPlain(options[i].styledLabel, opt, "opacity-25");
					} else {
						opt.textContent = options[i].label;
					}
					if (options[i].value === active) opt.classList.add("is-active");
					(function (val) {
						opt.addEventListener("click", function (e) {
							e.stopPropagation();
							setActive(val);
							updateActiveStates();
							fireFilter();
							updateTriggerLabel();
							wrapper.classList.remove("is-open");
						});
					})(options[i].value);
					list.appendChild(opt);
				}
			}

			trigger.addEventListener("click", function (e) {
				e.stopPropagation();
				var wasOpen = wrapper.classList.contains("is-open");
				bar.querySelectorAll(".filter-dropdown.is-open").forEach(function (d) {
					d.classList.remove("is-open");
				});
				if (!wasOpen) {
					buildList();
					wrapper.classList.add("is-open");
				}
			});

			wrapper.appendChild(trigger);
			wrapper.appendChild(list);
			updateTriggerLabel();
			wrapper.updateTriggerLabel = updateTriggerLabel;
			return wrapper;
		}

		const desktopWrap = document.createElement("nav");
		desktopWrap.className = "filter-bar-desktop";
		desktopWrap.setAttribute("aria-label", "Project filters");

		const projectsUl = document.createElement("ul");
		projectsUl.className = "filter-bar-list";
		addListLabel(projectsUl, "Projects:");
		addProjectBtn(projectsUl, "All", "all");
		for (let i = 0; i < projectNames.length; i++) {
			addSlashLi(projectsUl);
			addProjectBtn(
				projectsUl,
				graphicsProjectListLabel(projectNames[i]),
				projectNames[i],
				projectImageCounts[projectNames[i]],
			);
		}
		desktopWrap.appendChild(projectsUl);
		desktopWrap.appendChild(createGraphicsPortfolioMeta());
		bar.appendChild(desktopWrap);

		const mobileBar = document.createElement("div");
		mobileBar.className = "filter-bar-mobile";

		const mobileLabel = document.createElement("span");
		mobileLabel.className = "filter-bar-mobile-label opacity-25";
		mobileLabel.textContent = "Projects:";
		mobileBar.appendChild(mobileLabel);

		const projOptions = [{ label: "All", value: "all" }];
		for (let ci = 0; ci < projectNames.length; ci++) {
			const display = graphicsProjectListLabel(projectNames[ci]);
			projOptions.push({
				label: display,
				styledLabel: display,
				shortLabel: display.replace(/\s*\([^)]*\)/, ""),
				value: projectNames[ci],
				imageCount: projectImageCounts[projectNames[ci]],
			});
		}

		const projDropdownWrap = buildDropdown(
			"All",
			projOptions,
			function () {
				return activeProject || "all";
			},
			function (val) {
				activeProject = val === "all" ? null : val;
			},
		);
		mqlGraphicsMobileTrigger.addEventListener("change", function () {
			if (typeof projDropdownWrap.updateTriggerLabel === "function") {
				projDropdownWrap.updateTriggerLabel();
			}
		});
		mobileBar.appendChild(projDropdownWrap);
		mobileBar.appendChild(createGraphicsPortfolioMeta());

		document.addEventListener("click", function () {
			bar.querySelectorAll(".filter-dropdown.is-open").forEach(function (d) {
				d.classList.remove("is-open");
			});
		});

		bar.appendChild(mobileBar);

		updateActiveStates();

		bar._fireInitialFilter = function () {
			fireFilter();
		};
		return bar;
	}

	// =========================================================================
	// FULLSCREEN LIGHTBOX (work + photos)
	// =========================================================================

	function ensureGalleryLightbox() {
		if (galleryLightboxApi) return galleryLightboxApi;

		var root = document.createElement("div");
		root.className = "gallery-lightbox";
		root.id = "gallery-lightbox";
		root.setAttribute("hidden", "");
		root.setAttribute("aria-hidden", "true");
		root.setAttribute("role", "dialog");
		root.setAttribute("aria-modal", "true");
		root.setAttribute("aria-label", "Image");

		var projectEl = document.createElement("p");
		projectEl.className = "gallery-lightbox-project font-berkeley";

		var closeBtn = document.createElement("button");
		closeBtn.type = "button";
		closeBtn.className = "gallery-lightbox-close font-berkeley";
		closeBtn.setAttribute("aria-label", "Close");
		closeBtn.innerHTML =
			'Close <span class="opacity-50">[</span>×<span class="opacity-50">]</span>';

		var stage = document.createElement("div");
		stage.className = "gallery-lightbox-stage";

		var figure = document.createElement("div");
		figure.className = "gallery-lightbox-figure";

		var img = document.createElement("img");
		img.className = "gallery-lightbox-image";
		img.alt = "";

		var hitPrev = document.createElement("button");
		hitPrev.type = "button";
		hitPrev.className = "gallery-lightbox-hit gallery-lightbox-hit--prev";
		hitPrev.setAttribute("aria-label", "Previous");

		var hitNext = document.createElement("button");
		hitNext.type = "button";
		hitNext.className = "gallery-lightbox-hit gallery-lightbox-hit--next";
		hitNext.setAttribute("aria-label", "Next");

		figure.appendChild(img);
		figure.appendChild(hitPrev);
		figure.appendChild(hitNext);
		stage.appendChild(figure);

		var meta = document.createElement("div");
		meta.className = "gallery-lightbox-meta";

		var countEl = document.createElement("p");
		countEl.className = "gallery-lightbox-count font-berkeley";

		root.appendChild(projectEl);
		root.appendChild(closeBtn);
		root.appendChild(stage);
		root.appendChild(meta);
		root.appendChild(countEl);
		document.body.appendChild(root);

		var state = {
			open: false,
			entries: [],
			index: 0,
			sectionType: "graphics",
			imageBasePath: "/filing/v5/work/",
			isThemed: true,
			matchImageBackground: false,
			ambientToken: 0,
		};

		var ambientColorKeys = [
			"--color-bg",
			"--color-text",
			"--color-border",
			"--opacity-15",
			"--opacity-25",
			"--opacity-50",
			"--opacity-75",
			"--opacity-90",
		];

		function clearAmbientBackground() {
			root.classList.remove(
				"is-ambient",
				"gallery-lightbox--tone-dark",
				"gallery-lightbox--tone-light",
			);
			for (var i = 0; i < ambientColorKeys.length; i++) {
				root.style.removeProperty(ambientColorKeys[i]);
			}
		}

		function applyAmbientBackground(colorValue) {
			var rgb = parseCssColor(colorValue);
			if (!rgb) {
				clearAmbientBackground();
				return;
			}
			var hex = rgbToHex(rgb.r, rgb.g, rgb.b);
			var isDark = relativeLuminance(rgb.r, rgb.g, rgb.b) < 0.45;
			var textRgb = isDark ? "255, 255, 255" : "0, 0, 0";

			root.style.setProperty("--color-bg", hex);
			root.style.setProperty("--color-text", isDark ? "#ffffff" : "#000000");
			// Soft frame: ambient bg mixed toward text so the border is a tint, not grey
			var borderMix = isDark ? 0.14 : 0.12;
			var borderRgb = {
				r: rgb.r + (isDark ? 255 - rgb.r : 0 - rgb.r) * borderMix,
				g: rgb.g + (isDark ? 255 - rgb.g : 0 - rgb.g) * borderMix,
				b: rgb.b + (isDark ? 255 - rgb.b : 0 - rgb.b) * borderMix,
			};
			root.style.setProperty("--color-border", rgbToHex(borderRgb.r, borderRgb.g, borderRgb.b));
			root.style.setProperty("--opacity-15", "rgba(" + textRgb + ", 0.15)");
			root.style.setProperty("--opacity-25", "rgba(" + textRgb + ", 0.25)");
			root.style.setProperty("--opacity-50", "rgba(" + textRgb + ", 0.5)");
			root.style.setProperty("--opacity-75", "rgba(" + textRgb + ", 0.75)");
			root.style.setProperty("--opacity-90", "rgba(" + textRgb + ", 0.9)");

			root.classList.add("is-ambient");
			root.classList.toggle("gallery-lightbox--tone-dark", isDark);
			root.classList.toggle("gallery-lightbox--tone-light", !isDark);
		}

		function syncAmbientBackground(entry) {
			state.ambientToken += 1;
			var token = state.ambientToken;

			if (!state.matchImageBackground || !entry || !ambientBackgroundAllowed()) {
				clearAmbientBackground();
				return;
			}

			var preset = entry.bgColor || entry.lightboxBg || null;
			if (preset) {
				applyAmbientBackground(preset);
				return;
			}

			var cacheKey = entrySrc(entry);
			if (cacheKey && lightboxColorCache[cacheKey]) {
				applyAmbientBackground(lightboxColorCache[cacheKey]);
				return;
			}

			function applySampled(color, extraKeys) {
				if (!color) return false;
				var adjusted = darkenCssColor(color, 0.1);
				cacheAmbientColor(adjusted, [cacheKey, img.currentSrc || img.src].concat(extraKeys || []));
				applyAmbientBackground(adjusted);
				return true;
			}

			// Prefer the already-decoded grid thumb so open/nav doesn't wait on lightbox decode.
			var preview = findGridPreviewImage(entry.filename);
			if (preview && applySampled(extractAverageColor(preview), [preview.currentSrc || preview.src])) {
				return;
			}

			function sampleFromImage() {
				if (!state.open || token !== state.ambientToken) return;
				applySampled(extractAverageColor(img));
			}

			if (typeof img.decode === "function") {
				img.decode().then(sampleFromImage).catch(function () {
					if (img.complete && img.naturalWidth) sampleFromImage();
				});
			} else if (img.complete && img.naturalWidth) {
				sampleFromImage();
			} else {
				img.addEventListener("load", sampleFromImage, { once: true });
			}
		}

		function entrySrc(entry) {
			if (!entry || !entry.filename) return "";
			if (state.isThemed) {
				return getThemedSrc(state.imageBasePath, entry.filename, entry.shared === true);
			}
			return state.imageBasePath + entry.filename;
		}

		function renderMeta(entry) {
			meta.replaceChildren();
			if (!entry) return;

			var caption = document.createElement("div");
			caption.className = state.sectionType === "photos" ? "photo-caption" : "work-caption";

			var label = entry.number != null && entry.number !== "" ? String(entry.number) : "";
			var numberClass = state.sectionType === "photos" ? "photo-number" : "work-number";
			var descClass = state.sectionType === "photos" ? "photo-description" : "work-description";
			var metaLine = buildWorkTextLine(label, entry.description, numberClass, descClass);
			if (metaLine && metaLine.childNodes.length > 0) {
				caption.appendChild(metaLine);
			}

			if (entry.filename) {
				var displayPath = state.sectionType === "photos" ? "/filing/v5/photos/" : "/filing/work/";
				var sizeUrl = state.isThemed
					? state.imageBasePath + "dark/" + entry.filename
					: state.imageBasePath + entry.filename;
				var fileClass = state.sectionType === "photos" ? "photo-filename" : "work-filename";
				var built = buildFilenameLineElement(displayPath, entry.filename, fileClass);
				caption.appendChild(built.el);

				var metaToken = entry.filename;
				built.sizeSpan.dataset.metaToken = metaToken;
				getFileSize(sizeUrl).then(function (fileSize) {
					if (!state.open) return;
					if (built.sizeSpan.dataset.metaToken !== metaToken) return;
					if (fileSize) {
						built.sizeSpan.textContent = " (" + fileSize + "kb)";
					}
				});
			}

			meta.appendChild(caption);
		}

		function showIndex(i) {
			if (!state.entries.length) return;
			var n = state.entries.length;
			state.index = ((i % n) + n) % n;
			var entry = state.entries[state.index];

			var title = state.sectionType === "photos" ? entry.category || "" : entry.project || "";
			projectEl.replaceChildren();
			if (!title) {
				projectEl.classList.add("is-empty");
			} else {
				projectEl.classList.remove("is-empty");

				var link = document.createElement("a");
				link.href = "#";
				link.className = "gallery-lightbox-project-link";

				var nameSpan = document.createElement("span");
				nameSpan.className = "gallery-lightbox-project-name";
				nameSpan.textContent = title;
				link.appendChild(nameSpan);

				if (state.sectionType !== "photos" && entry.projectDate) {
					link.appendChild(document.createTextNode(" "));
					var dateSpan = document.createElement("span");
					dateSpan.className = "opacity-75";
					appendBracketStyledText(entry.projectDate, dateSpan);
					link.appendChild(dateSpan);
				}

				link.addEventListener("click", function (e) {
					e.preventDefault();
					e.stopPropagation();
					var navigate = state.onTitleNavigate;
					close();
					if (typeof navigate === "function") {
						navigate(title);
					}
				});

				projectEl.appendChild(link);
			}

			img.removeAttribute("data-base-path");
			img.removeAttribute("data-filename");
			img.removeAttribute("data-shared");
			if (state.isThemed) {
				img.dataset.basePath = state.imageBasePath;
				img.dataset.filename = entry.filename;
				img.dataset.shared = entry.shared === true ? "true" : "false";
			}
			img.src = entrySrc(entry);
			img.alt = entry.description || entry.filename || "";

			img.onerror = function () {
				if (!state.isThemed || !entry.filename) return;
				var darkSrc = state.imageBasePath + "dark/" + entry.filename;
				if (!this.src.endsWith(darkSrc)) {
					lightImageMissing.add(state.imageBasePath + entry.filename);
					this.src = darkSrc;
				}
			};

			syncAmbientBackground(entry);

			renderMeta(entry);

			countEl.replaceChildren();
			countEl.className = "gallery-lightbox-count font-berkeley";

			var navLine = document.createElement("span");
			navLine.className = "gallery-lightbox-count-nav";

			var prevLink = document.createElement("a");
			prevLink.href = "#";
			prevLink.className = "gallery-lightbox-count-arrow";
			prevLink.setAttribute("aria-label", "Previous");
			prevLink.textContent = "Previous";
			prevLink.addEventListener("click", function (e) {
				e.preventDefault();
				e.stopPropagation();
				step(-1);
			});

			var slash = document.createElement("span");
			slash.className = "opacity-25";
			slash.textContent = " / ";

			var nextLink = document.createElement("a");
			nextLink.href = "#";
			nextLink.className = "gallery-lightbox-count-arrow";
			nextLink.setAttribute("aria-label", "Next");
			nextLink.textContent = "Next";
			nextLink.addEventListener("click", function (e) {
				e.preventDefault();
				e.stopPropagation();
				step(1);
			});

			navLine.appendChild(prevLink);
			navLine.appendChild(slash);
			navLine.appendChild(nextLink);
			countEl.appendChild(navLine);

			var singular = state.statusLabel || "Image";
			var plural = singular + "s";
			var label = n === 1 ? singular : plural;
			var countLine = document.createElement("span");
			countLine.className = "opacity-25";
			countLine.textContent = state.index + 1 + " of " + n + " " + label;
			countEl.appendChild(countLine);

			var sizeSpan = document.createElement("span");
			sizeSpan.className = "opacity-15";
			countLine.appendChild(sizeSpan);

			var sizeToken =
				String(n) +
				":" +
				(state.entries[0] && state.entries[0].filename) +
				":" +
				(state.entries[n - 1] && state.entries[n - 1].filename);
			countEl.dataset.sizeToken = sizeToken;

			function applyTotalSize(sizeStr) {
				if (!state.open || countEl.dataset.sizeToken !== sizeToken) return;
				if (sizeStr) sizeSpan.textContent = " (" + sizeStr + ")";
			}

			if (state.cachedTotalSizeStr != null && state.cachedTotalSizeKey === sizeToken) {
				applyTotalSize(state.cachedTotalSizeStr);
			} else if (typeof state.getTotalSizeStr === "function") {
				Promise.resolve(state.getTotalSizeStr(state.entries)).then(function (sizeStr) {
					state.cachedTotalSizeKey = sizeToken;
					state.cachedTotalSizeStr = sizeStr || null;
					applyTotalSize(state.cachedTotalSizeStr);
				});
			} else {
				Promise.all(
					state.entries.map(function (ent) {
						var url = state.isThemed
							? state.imageBasePath + "dark/" + ent.filename
							: state.imageBasePath + ent.filename;
						return getFileSizeBytes(url);
					}),
				).then(function (sizes) {
					var sum = 0;
					var any = false;
					for (var si = 0; si < sizes.length; si++) {
						if (sizes[si] != null) {
							sum += sizes[si];
							any = true;
						}
					}
					state.cachedTotalSizeKey = sizeToken;
					state.cachedTotalSizeStr = any ? formatCompactDataSize(sum) : null;
					applyTotalSize(state.cachedTotalSizeStr);
				});
			}
		}

		function open(entries, startIndex, opts) {
			if (!entries || !entries.length) return;
			state.entries = entries;
			state.sectionType = opts.sectionType || "graphics";
			state.imageBasePath = opts.imageBasePath || "/filing/v5/work/";
			state.isThemed = opts.isThemed !== false;
			state.matchImageBackground = opts.matchImageBackground !== false;
			state.statusLabel = opts.statusLabel || "Image";
			state.onTitleNavigate =
				typeof opts.onTitleNavigate === "function" ? opts.onTitleNavigate : null;
			state.getTotalSizeStr =
				typeof opts.getTotalSizeStr === "function" ? opts.getTotalSizeStr : null;
			state.cachedTotalSizeStr = null;
			state.cachedTotalSizeKey = null;
			state.open = true;

			root.removeAttribute("hidden");
			root.classList.add("is-open");
			root.setAttribute("aria-hidden", "false");
			document.documentElement.classList.add("gallery-lightbox-open");

			showIndex(startIndex || 0);
			closeBtn.focus();
		}

		function close() {
			if (!state.open) return;
			state.open = false;
			state.ambientToken += 1;
			clearAmbientBackground();
			root.classList.remove("is-open");
			root.setAttribute("aria-hidden", "true");
			root.setAttribute("hidden", "");
			document.documentElement.classList.remove("gallery-lightbox-open");
			img.removeAttribute("src");
			meta.replaceChildren();
		}

		function refreshTheme() {
			if (!state.open || !state.isThemed) return;
			var entry = state.entries[state.index];
			if (!entry) return;
			img.src = entrySrc(entry);
			syncAmbientBackground(entry);
		}

		function onAmbientViewportChange() {
			if (!state.open) return;
			syncAmbientBackground(state.entries[state.index]);
		}

		if (typeof ambientDesktopMql.addEventListener === "function") {
			ambientDesktopMql.addEventListener("change", onAmbientViewportChange);
		} else if (typeof ambientDesktopMql.addListener === "function") {
			ambientDesktopMql.addListener(onAmbientViewportChange);
		}

		function step(delta) {
			if (!state.open) return;
			showIndex(state.index + delta);
		}

		closeBtn.addEventListener("click", function (e) {
			e.stopPropagation();
			close();
		});
		hitPrev.addEventListener("click", function (e) {
			e.stopPropagation();
			step(-1);
		});
		hitNext.addEventListener("click", function (e) {
			e.stopPropagation();
			step(1);
		});
		root.addEventListener("click", function () {
			close();
		});
		figure.addEventListener("click", function (e) {
			e.stopPropagation();
		});

		document.addEventListener("keydown", function (e) {
			if (!state.open) return;
			if (e.key === "Escape") {
				e.preventDefault();
				close();
			} else if (e.key === "ArrowLeft") {
				e.preventDefault();
				step(-1);
			} else if (e.key === "ArrowRight") {
				e.preventDefault();
				step(1);
			}
		});

		galleryLightboxApi = {
			open: open,
			close: close,
			refreshTheme: refreshTheme,
			isOpen: function () {
				return state.open;
			},
		};
		return galleryLightboxApi;
	}

	// =========================================================================
	// GALLERY INIT (shared by graphics and photos)
	// =========================================================================

	async function initGallery(config) {
		const sectionType = config.sectionType;
		const jsonPath = config.jsonPath;
		const renderFunction = config.renderFunction;
		const sectionSelector = config.sectionSelector;
		const contentSelector = config.contentSelector;
		const imageBasePath = config.imageBasePath;
		const statusLabel = config.statusLabel || "Image";
		const defaultAspectRatio = config.defaultAspectRatio || null;
		const isThemed = config.isThemed !== false;

		const section = document.querySelector(sectionSelector);
		if (!section) return;

		const workContent = section.querySelector(contentSelector);
		if (!workContent) return;

		const disclaimer = workContent.querySelector(".disclaimer");

		workContent.innerHTML = "";

		if (disclaimer) {
			workContent.appendChild(disclaimer);
		}

		const grid = document.createElement("div");
		grid.className = sectionType === "photos" ? "photo-grid" : "work-grid";
		workContent.appendChild(grid);

		const divider = document.createElement("hr");
		divider.className = "divider grid-footer-divider hidden";
		divider.setAttribute("aria-hidden", "true");

		const loadMoreRow = document.createElement("div");
		loadMoreRow.className = "load-more-row";

		const loadMoreBtn = document.createElement("button");
		loadMoreBtn.className = "load-more-button";
		loadMoreBtn.innerHTML = 'Load More <span class="opacity-50">[+]</span>';

		const loadMoreSep = document.createElement("span");
		loadMoreSep.className = "load-more-separator opacity-15";
		loadMoreSep.setAttribute("aria-hidden", "true");
		loadMoreSep.textContent = "/";

		const loadMoreStatus = document.createElement("span");
		loadMoreStatus.className = "load-more-status opacity-25";
		loadMoreStatus.setAttribute("aria-live", "polite");

		loadMoreRow.appendChild(loadMoreBtn);
		loadMoreRow.appendChild(loadMoreSep);
		loadMoreRow.appendChild(loadMoreStatus);
		loadMoreSep.classList.add("hidden");
		grid.appendChild(divider);
		grid.appendChild(loadMoreRow);
		grid._insertBeforeLoadMore = divider;

		let allItems = [];
		let displayedCount = 0;
		var activePhotoFilter = { category: null, tone: null, tag: null };

		try {
			let activeGraphicsProject = null;
			let filterChangeScrollEnabled = false;

			/** Photos + graphics: one implementation for --filter-bar-snap-top, is-stuck, listeners. */
			function bindFilterBarSticky(barEl, snapRootEl, infoElEl) {
				function syncFilterSnapTop() {
					snapRootEl.style.setProperty("--filter-bar-snap-top", infoElEl.offsetHeight + "px");
				}
				syncFilterSnapTop();
				window.addEventListener("resize", syncFilterSnapTop);

				function checkFilterStuck() {
					syncFilterSnapTop();
					var rect = barEl.getBoundingClientRect();
					var stickyTop =
						parseFloat(getComputedStyle(snapRootEl).getPropertyValue("--filter-bar-snap-top")) ||
						infoElEl.offsetHeight;
					var line = stickyTop + 1;
					var stickHyst = 16;
					var wasStuck = barEl.classList.contains("is-stuck");
					var stuck = wasStuck ? rect.top <= line + stickHyst : rect.top <= line;
					barEl.classList.toggle("is-stuck", stuck);
				}
				var filterStuckRaf = null;
				function scheduleFilterStuckCheck() {
					if (filterStuckRaf != null) return;
					filterStuckRaf = requestAnimationFrame(function () {
						filterStuckRaf = null;
						checkFilterStuck();
					});
				}
				window.addEventListener("scroll", scheduleFilterStuckCheck, { passive: true });
				if (window.visualViewport) {
					window.visualViewport.addEventListener("resize", function () {
						syncFilterSnapTop();
						scheduleFilterStuckCheck();
					});
				}
				barEl._syncStuck = checkFilterStuck;
				checkFilterStuck();
			}

			function scrollGridIntoViewAfterFilterTap() {
				if (!filterChangeScrollEnabled) return;

				function scheduleMobileSettleRetry(fn) {
					requestAnimationFrame(function () {
						requestAnimationFrame(fn);
					});
				}

				function measureAndScrollByFilterGeometry(isMobileSettlePass) {
					var mobileScroll = window.matchMedia(FILTER_BAR_MOBILE_MQL).matches;
					var gapPx = mobileScroll ? 12 : 16;
					var titleBelowFilterPad = mobileScroll ? 10 : 14;
					var minWantAnchorTopPx = mobileScroll ? 56 : 72;
					var doneEpsilon = isMobileSettlePass ? 2 : 4;

					if (filterBar && typeof filterBar._syncStuck === "function") {
						filterBar._syncStuck();
					}

					var filterEl =
						section.querySelector(".filter-bar") || workContent.querySelector(".filter-bar");
					if (!filterEl) return;

					/* After dropdown closes the trigger label height can change; flush layout before rects */
					void filterEl.offsetHeight;

					var anchor = null;
					if (sectionType === "graphics") {
						if (activeGraphicsProject) {
							var ttl = grid.querySelectorAll(".work-grid-title");
							for (var ti = 0; ti < ttl.length; ti++) {
								if (ttl[ti].getAttribute("data-project") === activeGraphicsProject) {
									anchor = ttl[ti];
									break;
								}
							}
						} else {
							anchor = grid.querySelector(".work-grid-title");
						}
					}
					if (!anchor && sectionType === "photos") {
						var photoItems = grid.querySelectorAll(".photo-item");
						for (var pi = 0; pi < photoItems.length; pi++) {
							if (photoItems[pi].style.display !== "none") {
								anchor = photoItems[pi];
								break;
							}
						}
					}
					/* Location (or combined) filter can hide every tile — scroll to empty-state copy under the bar, not .photo-intro */
					if (!anchor && (sectionType === "photos" || sectionType === "graphics")) {
						var emptyEl = workContent.querySelector(".no-results");
						if (emptyEl && emptyEl.style.display !== "none") {
							anchor = emptyEl;
						}
					}
					if (!anchor) {
						var introSel = sectionType === "graphics" ? ".work-intro" : ".photo-intro";
						anchor =
							section.querySelector(introSel) || section.querySelector(".section-label") || grid;
					}

					var wantAnchorTop;
					var alignToFilterBand =
						anchor &&
						anchor.classList &&
						(anchor.classList.contains("work-grid-title") ||
							anchor.classList.contains("photo-item") ||
							anchor.classList.contains("no-results"));
					if (alignToFilterBand && filterEl) {
						var fr = filterEl.getBoundingClientRect();
						wantAnchorTop = fr.bottom + gapPx + titleBelowFilterPad;
						if (wantAnchorTop < gapPx + 48) {
							var snap =
								parseFloat(getComputedStyle(section).getPropertyValue("--filter-bar-snap-top")) ||
								0;
							wantAnchorTop =
								snap +
								Math.max(fr.height, filterEl.offsetHeight || 52) +
								gapPx +
								titleBelowFilterPad;
						}
					} else {
						var snapTop =
							parseFloat(getComputedStyle(section).getPropertyValue("--filter-bar-snap-top")) || 0;
						wantAnchorTop = snapTop + gapPx + 48;
					}
					wantAnchorTop = Math.max(wantAnchorTop, minWantAnchorTopPx);

					var anchorTop = anchor.getBoundingClientRect().top;
					var delta = anchorTop - wantAnchorTop;
					if (Math.abs(delta) < doneEpsilon) {
						if (mobileScroll && !isMobileSettlePass) {
							scheduleMobileSettleRetry(function () {
								measureAndScrollByFilterGeometry(true);
							});
						}
						return;
					}
					/* Mobile: absolute scroll position is more reliable than scrollBy after long pages + load-more (iOS/subpixel). */
					if (mobileScroll) {
						var y = window.pageYOffset + delta;
						y = Math.max(
							0,
							Math.min(y, Math.max(0, document.documentElement.scrollHeight - window.innerHeight)),
						);
						window.scrollTo({ top: y, left: 0, behavior: "auto" });
					} else {
						window.scrollBy({
							top: delta,
							behavior: "smooth",
						});
					}
					if (filterBar && typeof filterBar._syncStuck === "function") {
						requestAnimationFrame(function () {
							filterBar._syncStuck();
						});
					}
					if (mobileScroll && !isMobileSettlePass) {
						scheduleMobileSettleRetry(function () {
							measureAndScrollByFilterGeometry(true);
						});
					}
				}

				/* Mobile: extra frame so sticky bar + dropdown label finish reflow (daas.graphics) */
				if (window.matchMedia(FILTER_BAR_MOBILE_MQL).matches) {
					requestAnimationFrame(function () {
						requestAnimationFrame(function () {
							requestAnimationFrame(function () {
								measureAndScrollByFilterGeometry(false);
							});
						});
					});
				} else {
					requestAnimationFrame(function () {
						requestAnimationFrame(function () {
							measureAndScrollByFilterGeometry(false);
						});
					});
				}
			}

			const response = await fetch(jsonPath);
			const data = await response.json();
			allItems = data.items || [];

			/** Set after displayNextBatch exists — loads batches until filtered project has tiles in the DOM. */
			let expandGraphicsFilterToVisible = async function () {};
			if (sectionType === "graphics") {
				assignWorkProjects(allItems);
			}

			let imageSizeBasePath = imageBasePath;
			if (isThemed) {
				imageSizeBasePath = imageBasePath + "dark/";
			}
			let imageBytesByIndex = null;

			function countImages(items) {
				let n = 0;
				for (let i = 0; i < items.length; i++) {
					if (items[i].filename) n++;
				}
				return n;
			}

			function countImagesShown(items, displayedItemCount) {
				let n = 0;
				const end = Math.min(displayedItemCount, items.length);
				for (let i = 0; i < end; i++) {
					if (items[i].filename) n++;
				}
				return n;
			}

			function itemMatchesPhotoFilter(item, f) {
				var catMatch = !f.category || item.category === f.category;
				var toneMatch = !f.tone || item.tone === f.tone;
				var tagMatch = !f.tag || (item.tags && item.tags.indexOf(f.tag) !== -1);
				return catMatch && toneMatch && tagMatch;
			}

			function isPhotoFilterActive(f) {
				return Boolean(f.category || f.tone || f.tag);
			}

			function countPhotosMatchingFilterInRange(items, f, displayedItemCount) {
				var n = 0;
				var end = Math.min(displayedItemCount, items.length);
				for (var i = 0; i < end; i++) {
					if (!items[i].filename) continue;
					if (itemMatchesPhotoFilter(items[i], f)) n++;
				}
				return n;
			}

			function countPhotosMatchingFilterTotal(items, f) {
				return countPhotosMatchingFilterInRange(items, f, items.length);
			}

			function itemMatchesGraphicsProject(item, proj) {
				return !proj || item.project === proj;
			}

			function isGraphicsProjectFilterActive() {
				return Boolean(activeGraphicsProject);
			}

			function countGraphicsImagesMatchingInRange(items, proj, displayedItemCount) {
				let n = 0;
				const end = Math.min(displayedItemCount, items.length);
				for (let i = 0; i < end; i++) {
					if (!items[i].filename) continue;
					if (!itemMatchesGraphicsProject(items[i], proj)) continue;
					n++;
				}
				return n;
			}

			function countGraphicsImagesMatchingTotal(items, proj) {
				return countGraphicsImagesMatchingInRange(items, proj, items.length);
			}

			const lightbox = ensureGalleryLightbox();

			function getLightboxBrowseEntries() {
				const out = [];
				for (let i = 0; i < allItems.length; i++) {
					const item = allItems[i];
					if (!item.filename) continue;
					if (sectionType === "photos" && isPhotoFilterActive(activePhotoFilter)) {
						if (!itemMatchesPhotoFilter(item, activePhotoFilter)) continue;
					}
					if (sectionType === "graphics" && isGraphicsProjectFilterActive()) {
						if (!itemMatchesGraphicsProject(item, activeGraphicsProject)) continue;
					}
					out.push(item);
				}
				return out;
			}

			function openLightboxForFilename(filename) {
				if (!filename) return;
				const entries = getLightboxBrowseEntries();
				let start = -1;
				for (let i = 0; i < entries.length; i++) {
					if (entries[i].filename === filename) {
						start = i;
						break;
					}
				}

				function navigateToTitle(title) {
					if (!title || !filterBar) return;
					if (sectionType === "graphics" && typeof filterBar._selectProject === "function") {
						filterBar._selectProject(title);
						return;
					}
					if (sectionType === "photos") {
						var catBtns = filterBar.querySelectorAll("[data-filter-category]");
						for (var ci = 0; ci < catBtns.length; ci++) {
							if (catBtns[ci].getAttribute("data-filter-category") === title) {
								catBtns[ci].click();
								return;
							}
						}
					}
				}

				var openOpts = {
					sectionType: sectionType,
					imageBasePath: imageBasePath,
					isThemed: isThemed,
					statusLabel: statusLabel,
					onTitleNavigate: navigateToTitle,
					getTotalSizeStr: function (entries) {
						function sumFromCache() {
							if (!imageBytesByIndex) return null;
							var byName = {};
							for (var i = 0; i < allItems.length; i++) {
								if (!allItems[i].filename) continue;
								if (imageBytesByIndex[i] != null) {
									byName[allItems[i].filename] = imageBytesByIndex[i];
								}
							}
							var sum = 0;
							var any = false;
							for (var j = 0; j < entries.length; j++) {
								var b = byName[entries[j].filename];
								if (b != null) {
									sum += b;
									any = true;
								}
							}
							return any ? formatCompactDataSize(sum) : null;
						}

						var cached = sumFromCache();
						if (cached) return Promise.resolve(cached);

						return Promise.all(
							entries.map(function (ent) {
								var url = isThemed
									? imageBasePath + "dark/" + ent.filename
									: imageBasePath + ent.filename;
								return getFileSizeBytes(url);
							}),
						).then(function (sizes) {
							var sum = 0;
							var any = false;
							for (var si = 0; si < sizes.length; si++) {
								if (sizes[si] != null) {
									sum += sizes[si];
									any = true;
								}
							}
							return any ? formatCompactDataSize(sum) : null;
						});
					},
				};

				if (start < 0) {
					const all = [];
					for (let j = 0; j < allItems.length; j++) {
						if (allItems[j].filename) all.push(allItems[j]);
					}
					for (let k = 0; k < all.length; k++) {
						if (all[k].filename === filename) {
							start = k;
							break;
						}
					}
					if (start < 0) return;
					lightbox.open(all, start, openOpts);
					return;
				}
				lightbox.open(entries, start, openOpts);
			}

			grid.addEventListener("click", function (e) {
				const frame = e.target.closest(".work-image-frame, .photo-image-frame");
				if (!frame || !grid.contains(frame)) return;
				const thumb = frame.querySelector("img");
				const filename = thumb && thumb.dataset.filename;
				if (!filename) return;
				e.preventDefault();
				openLightboxForFilename(filename);
			});

			/** True if any not-yet-rendered row still has an image that counts for the current view (filters apply). */
			function remainingMatchingFilenameItemsExist() {
				for (let i = displayedCount; i < allItems.length; i++) {
					const item = allItems[i];
					if (!item.filename) continue;
					if (sectionType === "photos") {
						if (isPhotoFilterActive(activePhotoFilter)) {
							if (!itemMatchesPhotoFilter(item, activePhotoFilter)) continue;
						}
						return true;
					}
					if (sectionType === "graphics") {
						if (isGraphicsProjectFilterActive()) {
							if (!itemMatchesGraphicsProject(item, activeGraphicsProject)) continue;
						}
						return true;
					}
				}
				return false;
			}

			let initialGridPaintDone = false;

			function syncLoadMoreButtonVisibility() {
				const fullyLoaded = displayedCount >= allItems.length;
				const noMoreMatchingImages = !remainingMatchingFilenameItemsExist();
				const hideLoadMore = fullyLoaded || noMoreMatchingImages;
				loadMoreBtn.classList.toggle("hidden", hideLoadMore);
				/* Hide footer HR only when idle and the last row is already a JSON divider (no double line).
				   After images/titles, keep the rule so "99 of 99" still matches the load-more layout. */
				if (initialGridPaintDone) {
					let prev = loadMoreRow.previousElementSibling;
					if (prev === divider) {
						prev = prev.previousElementSibling;
					}
					while (prev && getComputedStyle(prev).display === "none") {
						prev = prev.previousElementSibling;
					}
					const afterProjectDivider = Boolean(
						prev &&
						prev.classList &&
						(prev.classList.contains("work-grid-divider") ||
							prev.classList.contains("photo-grid-divider")),
					);
					const hideFooterRule = hideLoadMore && afterProjectDivider;
					divider.classList.toggle("hidden", hideFooterRule);
					loadMoreRow.classList.toggle("load-more-row--no-footer-rule", hideFooterRule);
					loadMoreRow.classList.toggle("load-more-row--after-project-divider", hideFooterRule);
				}
			}

			function sumBytesForDisplayedImages() {
				if (!imageBytesByIndex) return null;
				let sum = 0;
				let any = false;
				const end = Math.min(displayedCount, allItems.length);
				for (let i = 0; i < end; i++) {
					if (!allItems[i].filename) continue;
					if (sectionType === "photos" && isPhotoFilterActive(activePhotoFilter)) {
						if (!itemMatchesPhotoFilter(allItems[i], activePhotoFilter)) continue;
					}
					if (sectionType === "graphics" && isGraphicsProjectFilterActive()) {
						if (!itemMatchesGraphicsProject(allItems[i], activeGraphicsProject)) continue;
					}
					const b = imageBytesByIndex[i];
					if (b != null) {
						sum += b;
						any = true;
					}
				}
				return any ? sum : null;
			}

			function updateLoadMoreStatus() {
				const singularLabel = statusLabel;
				const pluralLabel = statusLabel + "s";
				var total;
				var shown;
				var label;
				if (sectionType === "photos" && isPhotoFilterActive(activePhotoFilter)) {
					shown = countPhotosMatchingFilterInRange(allItems, activePhotoFilter, displayedCount);
					total = countPhotosMatchingFilterTotal(allItems, activePhotoFilter);
					label = total === 1 ? "filtered " + singularLabel : "filtered " + pluralLabel;
				} else if (sectionType === "graphics" && isGraphicsProjectFilterActive()) {
					shown = countGraphicsImagesMatchingInRange(
						allItems,
						activeGraphicsProject,
						displayedCount,
					);
					total = countGraphicsImagesMatchingTotal(allItems, activeGraphicsProject);
					label = total === 1 ? "filtered " + singularLabel : "filtered " + pluralLabel;
				} else {
					total = countImages(allItems);
					shown = countImagesShown(allItems, displayedCount);
					label = total === 1 ? singularLabel : pluralLabel;
				}
				const sizeStr = formatCompactDataSize(sumBytesForDisplayedImages());
				loadMoreStatus.replaceChildren();
				loadMoreStatus.appendChild(document.createTextNode(shown + " of " + total + " " + label));
				if (sizeStr) {
					const sizeWrap = document.createElement("span");
					sizeWrap.className = "opacity-15";
					sizeWrap.textContent = " (" + sizeStr + ")";
					loadMoreStatus.appendChild(sizeWrap);
				}
				syncLoadMoreButtonVisibility();
				loadMoreSep.classList.toggle("hidden", loadMoreBtn.classList.contains("hidden"));
			}

			void (async function fetchImageByteSizes() {
				imageBytesByIndex = new Array(allItems.length);
				const tasks = [];
				for (let i = 0; i < allItems.length; i++) {
					imageBytesByIndex[i] = null;
					if (!allItems[i].filename) continue;
					const idx = i;
					const url = imageSizeBasePath + allItems[i].filename;
					tasks.push(
						getFileSizeBytes(url).then(function (bytes) {
							imageBytesByIndex[idx] = bytes;
						}),
					);
				}
				if (tasks.length === 0) return;
				await Promise.all(tasks);
				updateLoadMoreStatus();
			})();

			// Photo filter bar (only for photos); graphics project filter (designer)
			let filterBar = null;
			let applyGraphicsProjectFilter = function () {};
			if (sectionType === "photos") {
				var noResultsMsg = document.createElement("p");
				noResultsMsg.className = "no-results opacity-50";
				noResultsMsg.textContent = "No photos match the selected filters.";
				noResultsMsg.style.display = "none";

				function applyPhotoFilter() {
					var f = activePhotoFilter;
					var items = grid.querySelectorAll(".photo-item");
					var visibleCount = 0;
					items.forEach(function (el) {
						var elCat = el.getAttribute("data-category");
						var elTone = el.getAttribute("data-tone");
						var elTags = el.getAttribute("data-tags");
						var catMatch = !f.category || elCat === f.category;
						var toneMatch = !f.tone || elTone === f.tone;
						var tagMatch = !f.tag || (elTags && elTags.split(",").indexOf(f.tag) !== -1);
						var visible = catMatch && toneMatch && tagMatch;
						el.style.display = visible ? "" : "none";
						if (visible) visibleCount++;
					});
					noResultsMsg.style.display = visibleCount === 0 ? "" : "none";
				}

				filterBar = buildPhotoFilterBar(allItems, function (category, tone, tag) {
					activePhotoFilter.category = category;
					activePhotoFilter.tone = tone;
					activePhotoFilter.tag = tag;
					applyPhotoFilter();
					updateLoadMoreStatus();
					scrollGridIntoViewAfterFilterTap();
				});
				if (filterBar) {
					workContent.insertBefore(filterBar, grid);
					grid.parentNode.insertBefore(noResultsMsg, grid.nextSibling);

					document.addEventListener("click", function (e) {
						var link = e.target.closest("[data-filter-type]");
						if (!link) return;
						e.preventDefault();
						var type = link.getAttribute("data-filter-type");
						var value = link.getAttribute("data-filter-value");
						if (!type || !value) return;
						var selector = "[data-filter-" + type + '="' + value + '"]';
						var btn = filterBar.querySelector(selector);
						if (btn) btn.click();
					});

					var infoEl = document.querySelector(".info");
					if (infoEl) {
						bindFilterBarSticky(filterBar, section, infoEl);
					}
				}
			}

			if (sectionType === "graphics") {
				let graphicsNoResultsMsg = null;
				const projectImageCounts = {};
				for (let ii = 0; ii < allItems.length; ii++) {
					var row = allItems[ii];
					if (!row.filename || !row.project) continue;
					var pnKey = row.project;
					projectImageCounts[pnKey] = (projectImageCounts[pnKey] || 0) + 1;
				}
				const projectNames = [];
				const projectSeen = new Set();
				for (let pi = 0; pi < allItems.length; pi++) {
					const pn = allItems[pi].project;
					if (pn && !projectSeen.has(pn)) {
						projectSeen.add(pn);
						projectNames.push(pn);
					}
				}

				applyGraphicsProjectFilter = function () {
					var proj = activeGraphicsProject;
					grid
						.querySelectorAll(".work-item, .work-grid-title, .work-info-block, .work-grid-divider")
						.forEach(function (el) {
							var dp = el.getAttribute("data-project");
							var visible = !proj || dp === proj;
							el.style.display = visible ? "" : "none";
						});
					/* Section dividers sit between projects; when filtering, a trailing HR has no next
					   title/images — hide unless something substantive still follows in the grid.
					   Skip load-more/footer nodes (they live inside .work-grid since the gallery refactor). */
					if (proj) {
						var ch = grid.children;
						for (var ti = ch.length - 1; ti >= 0; ti--) {
							var node = ch[ti];
							if (node.classList.contains("load-more-row")) continue;
							if (node.classList.contains("grid-footer-divider")) continue;
							if (node.style.display === "none") continue;
							if (!node.classList.contains("work-grid-divider")) break;
							node.style.display = "none";
						}
					}
					if (graphicsNoResultsMsg) {
						var noneInDataset = proj && countGraphicsImagesMatchingTotal(allItems, proj) === 0;
						graphicsNoResultsMsg.style.display = noneInDataset ? "block" : "none";
					}
				};

				filterBar = buildGraphicsProjectFilterBar(
					projectNames,
					projectImageCounts,
					function (proj) {
						activeGraphicsProject = proj;
						applyGraphicsProjectFilter();
						updateLoadMoreStatus();
						void expandGraphicsFilterToVisible().then(function () {
							applyGraphicsProjectFilter();
							updateLoadMoreStatus();
							scrollGridIntoViewAfterFilterTap();
						});
					},
				);
				if (filterBar) {
					workContent.insertBefore(filterBar, grid);

					graphicsNoResultsMsg = document.createElement("p");
					graphicsNoResultsMsg.className = "no-results opacity-50";
					graphicsNoResultsMsg.textContent = "No work matches the selected project.";
					graphicsNoResultsMsg.style.display = "none";
					grid.parentNode.insertBefore(graphicsNoResultsMsg, grid.nextSibling);

					var gfxInfoEl = document.querySelector(".info");
					if (gfxInfoEl) {
						bindFilterBarSticky(filterBar, section, gfxInfoEl);
					}
				}
			}

			function calculateDisplayCount(items, maxColumns) {
				let totalColumns = 0;
				let count = 0;

				for (let i = 0; i < items.length; i++) {
					const item = items[i];
					if (
						sectionType === "graphics" &&
						(item.divider || item.type === "title" || item.type === "info")
					) {
						count++;
						continue;
					}

					const itemColumns = item.columns || 1;

					if (totalColumns + itemColumns <= maxColumns) {
						totalColumns += itemColumns;
						count++;
					} else {
						break;
					}
				}

				return count;
			}

			function countMobileBatchItems(items, maxContentItems) {
				let contentIncluded = 0;
				let count = 0;

				for (let i = 0; i < items.length; i++) {
					const item = items[i];
					if (
						sectionType === "graphics" &&
						(item.divider || item.type === "title" || item.type === "info")
					) {
						count++;
						continue;
					}
					if (contentIncluded >= maxContentItems) break;
					contentIncluded++;
					count++;
				}

				return count;
			}

			function isGraphicsBatchDeferrableTailItem(item) {
				return item && (item.divider === true || item.type === "title");
			}

			function adjustBatchCountForTrailingDividers(remainingItems, rawBatchCount) {
				if (sectionType !== "graphics" || rawBatchCount === 0) {
					return rawBatchCount;
				}
				if (rawBatchCount >= remainingItems.length) {
					return rawBatchCount;
				}
				let n = rawBatchCount;
				while (n > 0 && isGraphicsBatchDeferrableTailItem(remainingItems[n - 1])) {
					n--;
				}
				if (n === 0) {
					n = rawBatchCount;
					while (
						n < remainingItems.length &&
						isGraphicsBatchDeferrableTailItem(remainingItems[n - 1])
					) {
						n++;
					}
				}
				return n;
			}

			const isMobile = window.matchMedia("(max-width: 1080px)").matches;

			const rawInitialCount = isMobile
				? countMobileBatchItems(allItems, 4)
				: calculateDisplayCount(allItems, 40);
			const initialDisplayCount = adjustBatchCountForTrailingDividers(allItems, rawInitialCount);

			async function displayNextBatch() {
				const remainingItems = allItems.slice(displayedCount);

				let rawBatchCount;
				if (isMobile) {
					rawBatchCount = countMobileBatchItems(remainingItems, 8);
				} else {
					rawBatchCount = calculateDisplayCount(remainingItems, 40);
				}
				const batchCount = adjustBatchCountForTrailingDividers(remainingItems, rawBatchCount);

				if (batchCount === 0) {
					updateLoadMoreStatus();
					return;
				}

				const batch = remainingItems.slice(0, batchCount);

				for (let i = 0; i < batch.length; i++) {
					if (sectionType === "photos") {
						renderFunction(batch[i], grid, config);
					} else {
						await renderFunction(batch[i], grid);
					}
				}
				displayedCount += batch.length;

				setupLazyLoading();

				updateLoadMoreStatus();
				if (sectionType === "photos") applyPhotoFilter();
				if (sectionType === "graphics") applyGraphicsProjectFilter();

				/* Status can show full image count while JSON rows remain (titles/dividers). Hide button and pull those in. */
				if (displayedCount < allItems.length && !remainingMatchingFilenameItemsExist()) {
					await displayNextBatch();
				}
			}

			expandGraphicsFilterToVisible = async function () {
				if (sectionType !== "graphics" || !activeGraphicsProject) return;
				const proj = activeGraphicsProject;
				if (countGraphicsImagesMatchingTotal(allItems, proj) === 0) return;

				while (displayedCount < allItems.length) {
					let visibleMatching = 0;
					grid.querySelectorAll(".work-item").forEach(function (el) {
						if (el.getAttribute("data-project") !== proj) return;
						if (el.style.display === "none") return;
						visibleMatching++;
					});
					if (visibleMatching > 0) break;
					var before = displayedCount;
					await displayNextBatch();
					if (displayedCount === before) break;
				}
			};

			loadMoreBtn.addEventListener("click", function () {
				displayNextBatch();
			});

			displayedCount = 0;
			const firstBatch = allItems.slice(0, initialDisplayCount);
			(async function () {
				for (let i = 0; i < firstBatch.length; i++) {
					if (sectionType === "photos") {
						renderFunction(firstBatch[i], grid, config);
					} else {
						await renderFunction(firstBatch[i], grid);
					}
				}
				displayedCount = firstBatch.length;

				setupLazyLoading();

				initialGridPaintDone = true;
				updateLoadMoreStatus();
				if (filterBar && filterBar._fireInitialFilter) {
					filterBar._fireInitialFilter();
				}
				filterChangeScrollEnabled = true;

				while (displayedCount < allItems.length && !remainingMatchingFilenameItemsExist()) {
					await displayNextBatch();
				}
			})().catch(function (error) {
				console.error("Error displaying batch:", error);
			});
		} catch (error) {
			console.error("Error loading gallery:", error);
			workContent.innerHTML = "<p class='opacity-50'>Error loading gallery.</p>";
		}
	}

	// =========================================================================
	// INITIALIZE
	// =========================================================================

	if (!DISABLE_JSON_LOADING) {
		initGallery({
			sectionType: "graphics",
			jsonPath: "/filing/v5/data/work.json",
			renderFunction: renderGraphicsItem,
			sectionSelector: ".work-samples",
			contentSelector: ".work-content",
			imageBasePath: "/filing/v5/work/",
			isThemed: true,
			statusLabel: "Image",
		});

		initGallery({
			sectionType: "photos",
			jsonPath: "/filing/v5/data/photos.json",
			renderFunction: renderPhotoItem,
			sectionSelector: ".photo-samples",
			contentSelector: ".photo-content",
			imageBasePath: "/filing/v5/photos/",
			isThemed: false,
			defaultAspectRatio: 3 / 2,
			statusLabel: "Photo",
		});
	}
});
