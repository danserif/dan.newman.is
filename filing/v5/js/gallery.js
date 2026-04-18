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

	function getThemedSrc(basePath, filename) {
		const isLight = document.documentElement.classList.contains("light-mode");
		if (isLight && !lightImageMissing.has(basePath + filename)) {
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
				var newSrc = getThemedSrc(basePath, filename);

				if (img.dataset.src) {
					img.dataset.src = newSrc;
				} else if (img.src) {
					img.src = newSrc;
				}
			});
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

	// Append text to a parent element, wrapping any "(...)" segments in a span with opacity-50,
	// and "<Name/>"-style tokens so only "<" and "/>" use opacity-50 (inner name stays full opacity).
	function appendBracketStyledText(text, parent) {
		if (!text) return;
		const tagParts = text.split(/(<[^/]+\/>)/);

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

			const parts = segment.split(/(\([^)]*\))/);
			parts.forEach(function (part) {
				if (!part) return;
				const span = document.createElement("span");
				if (part.startsWith("(") && part.endsWith(")")) {
					span.className = "opacity-50";
				}
				span.textContent = part;
				parent.appendChild(span);
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
	async function createWorkImage(basePath, filename, altText, dims) {
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
		img.dataset.src = getThemedSrc(basePath, filename);
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
			if (this.src && !this.src.endsWith(darkSrc)) {
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
		const filename = document.createElement("p");
		filename.className = className || "work-filename";

		let sizeText = "";
		if (sizeUrl) {
			const fileSize = await getFileSize(sizeUrl);
			if (fileSize) {
				sizeText = ` (${fileSize}kb)`;
			}
		}

		filename.innerHTML =
			'<span class="opacity-15">&#8985;</span> ' +
			'<span class="opacity-25">' +
			displayPath +
			"</span>" +
			'<span class="opacity-25">' +
			displayName +
			"</span> " +
			'<span class="opacity-15">' +
			sizeText +
			"</span>";

		return filename;
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
			container.appendChild(wrap);
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
			container.appendChild(hr);
			return;
		}

		if (item.type === "title") {
			renderGraphicsTitleItem(item, container);
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
			const frame = await createWorkImage("/filing/v5/work/", item.filename, altText, item);
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
		container.appendChild(workItem);
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
		container.appendChild(photoItem);
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
		for (let i = 0; i < items.length; i++) {
			const it = items[i];
			if (it.type === "title" && it.name) {
				proj = it.name;
			}
			it.project = proj;
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

		let activeProject = null;

		function fireFilter() {
			onProjectChange(activeProject);
		}

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
						if (typeof match.imageCount === "number") {
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

		mobileBar.appendChild(
			buildDropdown(
				"All",
				projOptions,
				function () {
					return activeProject || "all";
				},
				function (val) {
					activeProject = val === "all" ? null : val;
				},
			),
		);
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
		divider.className = "divider hidden";
		workContent.appendChild(divider);

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
		workContent.appendChild(loadMoreRow);

		let allItems = [];
		let displayedCount = 0;
		var activePhotoFilter = { category: null, tone: null, tag: null };

		try {
			let activeGraphicsProject = null;
			let filterChangeScrollEnabled = false;

			function scrollGridIntoViewAfterFilterTap() {
				if (!filterChangeScrollEnabled) return;
				/* Double rAF: layout after filter DOM / sticky state updates */
				requestAnimationFrame(function () {
					requestAnimationFrame(function () {
						var gapPx = 16;
						var infoNav = document.querySelector(".page-content .info");
						var filterEl =
							section.querySelector(".filter-bar") || workContent.querySelector(".filter-bar");

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
								/* All: same scroll target as other filters — first project title (Klim…) */
								anchor = grid.querySelector(".work-grid-title");
							}
						}
						if (!anchor) {
							var introSel = sectionType === "graphics" ? ".work-intro" : ".photo-intro";
							anchor =
								section.querySelector(introSel) || section.querySelector(".section-label") || grid;
						}

						var wantAnchorTop;
						/* Extra air between sticky filter and project title (only title alignment) */
						var titleBelowFilterPad = 14;
						if (anchor && anchor.classList.contains("work-grid-title") && filterEl) {
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
							wantAnchorTop = (infoNav ? infoNav.getBoundingClientRect().bottom : 64) + gapPx;
						}
						wantAnchorTop = Math.max(wantAnchorTop, 72);

						var anchorTop = anchor.getBoundingClientRect().top;
						var delta = anchorTop - wantAnchorTop;
						if (Math.abs(delta) < 4) return;
						window.scrollBy({ top: delta, behavior: "smooth" });
					});
				});
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

			function syncLoadMoreButtonVisibility() {
				const fullyLoaded = displayedCount >= allItems.length;
				const noMoreMatchingImages = !remainingMatchingFilenameItemsExist();
				loadMoreBtn.classList.toggle("hidden", fullyLoaded || noMoreMatchingImages);
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
					var isMobileLayout = window.matchMedia(FILTER_BAR_MOBILE_MQL);
					if (infoEl) {
						var snapRoot = section;

						function syncFilterSnapTop() {
							snapRoot.style.setProperty("--filter-bar-snap-top", infoEl.offsetHeight + "px");
						}
						syncFilterSnapTop();
						window.addEventListener("resize", syncFilterSnapTop);

						function checkFilterStuck() {
							var rect = filterBar.getBoundingClientRect();
							var mobile = isMobileLayout.matches;
							/* Desktop: stick when bar reaches slot under nav. Mobile: viewport top handoff.
							   Mobile needs a wider threshold + hysteresis: iOS viewport/chrome shifts and
							   sticky layout feedback can otherwise toggle is-stuck multiple times per frame
							   when scrolling up past the URL row. */
							var stickyTop = mobile ? 0 : infoEl.offsetHeight;
							var line = stickyTop + (mobile ? 6 : 1);
							var stickHyst = mobile ? 48 : 16;
							var wasStuck = filterBar.classList.contains("is-stuck");
							var stuck = wasStuck ? rect.top <= line + stickHyst : rect.top <= line;
							filterBar.classList.toggle("is-stuck", stuck);

							if (mobile) {
								if (stuck) {
									snapRoot.style.setProperty("--filter-bar-snap-top", "0px");
								} else if (wasStuck && !stuck) {
									syncFilterSnapTop();
								}
							}
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
						checkFilterStuck();
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
						.querySelectorAll(".work-item, .work-grid-title, .work-grid-divider")
						.forEach(function (el) {
							var dp = el.getAttribute("data-project");
							var visible = !proj || dp === proj;
							el.style.display = visible ? "" : "none";
						});
					/* Section dividers sit between projects; when filtering, a trailing HR has no next
					   title/images — hide unless something substantive still follows in the grid. */
					if (proj) {
						var ch = grid.children;
						for (var ti = ch.length - 1; ti >= 0; ti--) {
							var node = ch[ti];
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
					var gfxIsMobileLayout = window.matchMedia(FILTER_BAR_MOBILE_MQL);
					if (gfxInfoEl) {
						var gfxSnapRoot = section;

						function gfxSyncFilterSnapTop() {
							gfxSnapRoot.style.setProperty("--filter-bar-snap-top", gfxInfoEl.offsetHeight + "px");
						}
						gfxSyncFilterSnapTop();
						window.addEventListener("resize", gfxSyncFilterSnapTop);

						function gfxCheckFilterStuck() {
							var rect = filterBar.getBoundingClientRect();
							var mobile = gfxIsMobileLayout.matches;
							var stickyTop = mobile ? 0 : gfxInfoEl.offsetHeight;
							var line = stickyTop + (mobile ? 6 : 1);
							var stickHyst = mobile ? 48 : 16;
							var wasStuck = filterBar.classList.contains("is-stuck");
							var stuck = wasStuck ? rect.top <= line + stickHyst : rect.top <= line;
							filterBar.classList.toggle("is-stuck", stuck);

							if (mobile) {
								if (stuck) {
									gfxSnapRoot.style.setProperty("--filter-bar-snap-top", "0px");
								} else if (wasStuck && !stuck) {
									gfxSyncFilterSnapTop();
								}
							}
						}
						var gfxFilterStuckRaf = null;
						function gfxScheduleFilterStuckCheck() {
							if (gfxFilterStuckRaf != null) return;
							gfxFilterStuckRaf = requestAnimationFrame(function () {
								gfxFilterStuckRaf = null;
								gfxCheckFilterStuck();
							});
						}
						window.addEventListener("scroll", gfxScheduleFilterStuckCheck, { passive: true });
						gfxCheckFilterStuck();
					}
				}
			}

			function calculateDisplayCount(items, maxColumns) {
				let totalColumns = 0;
				let count = 0;

				for (let i = 0; i < items.length; i++) {
					const item = items[i];
					if (sectionType === "graphics" && (item.divider || item.type === "title")) {
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
					if (sectionType === "graphics" && (item.divider || item.type === "title")) {
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

				divider.classList.remove("hidden");
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
