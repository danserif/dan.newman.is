// gallery.js
// Graphics / Clients

document.addEventListener("DOMContentLoaded", function () {
	const ITEMS_PER_PAGE = 12;

	// Development controls: Temporarily disable JSON loading
	// Set to true to skip loading graphics.json
	const DISABLE_JSON_LOADING = false;

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

	// Optional width/height from JSON (canonical dark/ pixels); avoids per-tile probe when present.
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
	// basePath: e.g. "/filing/v5/work/", filename: e.g. "project.jpg"
	// dims: optional { width, height } from JSON; otherwise awaits dark/ probe before paint.
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

	// Build the "meta" caption line as a <p class="work-text"> with spans inside
	// leftTextClass is e.g. "work-client" or "work-number"
	function buildWorkTextLine(leftText, descriptionText, leftTextClass) {
		if (!leftText && !descriptionText) return null;

		const metaLine = document.createElement("p");
		metaLine.className = "work-text";

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
			description.className = "work-description";
			// Leading space before description
			appendBracketStyledText(" " + descriptionText, description);
			metaLine.appendChild(description);
		}

		return metaLine;
	}

	// Build filename line <p class="work-filename"> with ⌙, path, filename, and optional size
	async function buildWorkFilenameLine(basePath, displayName, sizeUrl) {
		const filename = document.createElement("p");
		filename.className = "work-filename";

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
			basePath +
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

	// Caption line: dim [URL] + path; linkDisplay shortens visible path, href still from link
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

	// Full-width section title (graphics.json: type "title")
	function renderGraphicsTitleItem(item, container) {
		const wrap = document.createElement("div");
		wrap.className = "work-grid-title";

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

	// Render Graphics/Clients item
	async function renderGraphicsItem(item, container) {
		if (item.divider) {
			const hr = document.createElement("hr");
			hr.className = "divider work-grid-divider";
			hr.setAttribute("aria-hidden", "true");
			container.appendChild(hr);
			return;
		}

		if (item.type === "title") {
			renderGraphicsTitleItem(item, container);
			return;
		}

		const workItem = document.createElement("div");
		workItem.className = "work-item";
		// Allow 1, 2, 3, or 4 columns, default to 1
		const columns = item.columns && [1, 2, 3, 4].includes(item.columns) ? item.columns : 1;
		workItem.setAttribute("data-columns", columns);

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

		// Caption
		const caption = document.createElement("div");
		caption.className = "work-caption";

		// Graphics: number // description
		const metaLine = buildWorkTextLine(graphicsLabel, item.description, "work-number");
		if (metaLine && metaLine.childNodes.length > 0) {
			caption.appendChild(metaLine);
		}

		if (item.filename) {
			const fileToShow = item.filename;
			const sizeUrl = "/filing/v5/work/dark/" + fileToShow;
			buildWorkFilenameLine("/filing/work/", fileToShow, sizeUrl).then(function (filenameEl) {
				caption.appendChild(filenameEl);
				const linkEl = buildWorkLinkLine(item.link, item.linkDisplay);
				if (linkEl) caption.appendChild(linkEl);
			});
		}

		workItem.appendChild(caption);
		container.appendChild(workItem);
	}

	// Load and render work gallery
	async function initWorkGallery(sectionType, jsonPath, renderFunction) {
		const section = document.querySelector(".work-samples");
		if (!section) return;

		const workContent = section.querySelector(".work-content");
		if (!workContent) return;

		// Preserve any existing disclaimer block in the work-content
		const disclaimer = workContent.querySelector(".disclaimer");

		// Remove placeholder content
		workContent.innerHTML = "";

		// Re-insert disclaimer (if present) at the top of work-content
		if (disclaimer) {
			workContent.appendChild(disclaimer);
		}

		// Create grid container
		const grid = document.createElement("div");
		grid.className = "work-grid";
		workContent.appendChild(grid);

		// Divider between grid and load-more / image count row (hidden until first batch paints)
		const divider = document.createElement("hr");
		divider.className = "divider hidden";
		workContent.appendChild(divider);

		// Load more control + live image count (items with filename only)
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

		try {
			const response = await fetch(jsonPath);
			const data = await response.json();
			allItems = data.items || [];

			const workImageBasePath = "/filing/v5/work/";
			let workImageBytesByIndex = null;

			function countWorkImages(items) {
				let n = 0;
				for (let i = 0; i < items.length; i++) {
					if (items[i].filename) {
						n++;
					}
				}
				return n;
			}

			function countWorkImagesShown(items, displayedItemCount) {
				let n = 0;
				const end = Math.min(displayedItemCount, items.length);
				for (let i = 0; i < end; i++) {
					if (items[i].filename) {
						n++;
					}
				}
				return n;
			}

			function sumBytesForDisplayedImages() {
				if (!workImageBytesByIndex) {
					return null;
				}
				let sum = 0;
				let any = false;
				const end = Math.min(displayedCount, allItems.length);
				for (let i = 0; i < end; i++) {
					if (!allItems[i].filename) {
						continue;
					}
					const b = workImageBytesByIndex[i];
					if (b != null) {
						sum += b;
						any = true;
					}
				}
				return any ? sum : null;
			}

			function updateLoadMoreStatus() {
				const total = countWorkImages(allItems);
				const shown = countWorkImagesShown(allItems, displayedCount);
				const label = total === 1 ? "Image" : "Images";
				const sizeStr = formatCompactDataSize(sumBytesForDisplayedImages());
				loadMoreStatus.replaceChildren();
				loadMoreStatus.appendChild(document.createTextNode(shown + " of " + total + " " + label));
				if (sizeStr) {
					const sizeWrap = document.createElement("span");
					sizeWrap.className = "opacity-15";
					sizeWrap.textContent = " (" + sizeStr + ")";
					loadMoreStatus.appendChild(sizeWrap);
				}
				loadMoreSep.classList.toggle("hidden", loadMoreBtn.classList.contains("hidden"));
			}

			void (async function fetchWorkImageByteSizesByIndex() {
				workImageBytesByIndex = new Array(allItems.length);
				const tasks = [];
				for (let i = 0; i < allItems.length; i++) {
					workImageBytesByIndex[i] = null;
					if (!allItems[i].filename) {
						continue;
					}
					const idx = i;
					const url = workImageBasePath + "dark/" + allItems[i].filename;
					tasks.push(
						getFileSizeBytes(url).then(function (bytes) {
							workImageBytesByIndex[idx] = bytes;
						}),
					);
				}
				if (tasks.length === 0) {
					return;
				}
				await Promise.all(tasks);
				updateLoadMoreStatus();
			})();

			// Use JSON array order

			// Calculate how many items fit within a given column budget (maxColumns).
			// Graphics dividers and title rows are included in the slice but do not consume column budget.
			// Used to cap initial display (2 rows) and "Load more" batches on desktop (separate larger budget per click below)
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

			// Mobile: cap by image "content" slots; dividers / title rows in between are included but not counted toward the cap
			function countMobileBatchItems(items, maxContentItems) {
				let contentIncluded = 0;
				let count = 0;

				for (let i = 0; i < items.length; i++) {
					const item = items[i];
					if (sectionType === "graphics" && (item.divider || item.type === "title")) {
						count++;
						continue;
					}
					if (contentIncluded >= maxContentItems) {
						break;
					}
					contentIncluded++;
					count++;
				}

				return count;
			}

			function isGraphicsBatchDeferrableTailItem(item) {
				return item && (item.divider === true || item.type === "title");
			}

			// Graphics: do not end a batch with a divider or title row when more items exist after (defer until next batch).
			// Final batch (reaches end of list) keeps trailing divider/title. If the raw batch is only deferrable rows but more follow, extend until it ends with image/content.
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

			// Detect mobile layout (single-column work grid; matches CSS max-width: 1080px)
			const isMobile = window.matchMedia("(max-width: 1080px)").matches;

			// Initial display:
			// - Desktop: max 4 rows (40 columns at largest breakpoint)
			// - Mobile: max 4 content items (+ graphics dividers in the same slice)
			const rawInitialCount = isMobile
				? countMobileBatchItems(allItems, 4)
				: calculateDisplayCount(allItems, 40);
			const initialDisplayCount = adjustBatchCountForTrailingDividers(allItems, rawInitialCount);

			async function displayNextBatch() {
				const remainingItems = allItems.slice(displayedCount);

				// Each click: larger batch than initial paint (desktop ~4 rows, mobile 8 tiles)
				let rawBatchCount;
				if (isMobile) {
					rawBatchCount = countMobileBatchItems(remainingItems, 8);
				} else {
					rawBatchCount = calculateDisplayCount(remainingItems, 40);
				}
				const batchCount = adjustBatchCountForTrailingDividers(remainingItems, rawBatchCount);

				if (batchCount === 0) {
					loadMoreBtn.classList.add("hidden");
					updateLoadMoreStatus();
					return;
				}

				const batch = remainingItems.slice(0, batchCount);

				for (let i = 0; i < batch.length; i++) {
					await renderFunction(batch[i], grid);
				}
				displayedCount += batch.length;

				// Setup lazy loading for new images
				setupLazyLoading();

				if (displayedCount >= allItems.length) {
					loadMoreBtn.classList.add("hidden");
				}
				updateLoadMoreStatus();
			}

			loadMoreBtn.addEventListener("click", function () {
				displayNextBatch();
			});

			// Display first batch
			displayedCount = 0;
			const firstBatch = allItems.slice(0, initialDisplayCount);
			(async function () {
				for (let i = 0; i < firstBatch.length; i++) {
					await renderFunction(firstBatch[i], grid);
				}
				displayedCount = firstBatch.length;

				// Setup lazy loading for new images
				setupLazyLoading();

				if (displayedCount >= allItems.length) {
					loadMoreBtn.classList.add("hidden");
				}
				divider.classList.remove("hidden");
				updateLoadMoreStatus();
			})().catch(function (error) {
				console.error("Error displaying batch:", error);
			});
		} catch (error) {
			console.error("Error loading work gallery:", error);
			workContent.innerHTML = "<p class='opacity-50'>Error loading gallery.</p>";
		}
	}

	// Initialize galleries (only if not disabled)
	if (!DISABLE_JSON_LOADING) {
		initWorkGallery("graphics", "/filing/v5/data/work.json", renderGraphicsItem);
	}
});
