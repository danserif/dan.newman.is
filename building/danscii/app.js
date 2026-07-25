(function () {
	var DEFAULT_SRC = "/filing/v5/images/dan-newman.jpg";
	var CHAR_PRESETS = {
		more: " .'`^\",:;Il!i~+?]{|/trnuvczXYUJCLQ0mwqdbkho*#MW&8%B@$",
		less: " ·•+=#%@",
		numbers: " .,:;!~-+1234567890",
		letters: " .,:;!~-+abcdefghijklmnopqrstuvwxyz",
		dense: " .·°∙•◦▪▫▮■◆●◉",
		blocks: " .:░▒▓█",
	};
	// Long starter ramp for Custom — edit freely once selected.
	var CUSTOM_CHARS =
		" .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$░▒▓█■▪▫◦•∙·°º";
	var DEFAULT_PRESET = "blocks";
	var DEFAULT_CHARS = CHAR_PRESETS.blocks;
	var MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
	var MAX_FILE_LABEL = "5 MB";
	var mount = document.getElementById("danscii-preview");
	var form = document.getElementById("danscii-controls");
	var fileInput = document.getElementById("danscii-file");
	var fileErrorEl = document.getElementById("danscii-file-error");
	var charactersPreset = document.getElementById("charactersPreset");
	var charactersCustom = document.getElementById("charactersCustom");
	var charactersCustomNote = document.getElementById("charactersCustomNote");
	var charactersSelect = document.getElementById("charactersSelect");
	var charactersSelectTrigger = document.getElementById("charactersSelectTrigger");
	var charactersSelectCaret = document.getElementById("charactersSelectCaret");
	var charactersSelectList = document.getElementById("charactersSelectList");
	var charactersSelectValue = document.getElementById("charactersSelectValue");
	var downloadBtn = document.getElementById("danscii-download");
	var exportBtn = document.getElementById("danscii-export");
	var resetBtn = document.getElementById("danscii-reset");
	var statusEl = document.querySelector(".danscii-status");
	var moduleSource = null;
	var objectUrl = null;
	var currentImageFile = null;
	var PRIMARY_COLORS = [
		"#ff0000",
		"#0044ff",
		"#00aa00",
		"#ffdd00",
		"#ff7700",
		"#8800ff",
		"#ff3d9a",
	];
	var SITE_COLORS = {
		"#000000": true,
		"#ffffff": true,
		"#ff0000": true,
		"#0044ff": true,
		"#00aa00": true,
		"#ffdd00": true,
		"#ff7700": true,
		"#8800ff": true,
		"#ff3d9a": true,
	};
	var colorFields = {
		fg: {
			input: document.getElementById("colorFg"),
			select: document.getElementById("colorFgSelect"),
			trigger: document.getElementById("colorFgTrigger"),
			caret: document.getElementById("colorFgCaret"),
			list: document.getElementById("colorFgList"),
			chip: document.getElementById("colorFgChip"),
			valueEl: document.getElementById("colorFgValue"),
			custom: document.getElementById("colorFgCustom"),
			isCustom: false,
		},
		hover: {
			input: document.getElementById("colorHover"),
			select: document.getElementById("colorHoverSelect"),
			trigger: document.getElementById("colorHoverTrigger"),
			caret: document.getElementById("colorHoverCaret"),
			list: document.getElementById("colorHoverList"),
			chip: document.getElementById("colorHoverChip"),
			valueEl: document.getElementById("colorHoverValue"),
			custom: document.getElementById("colorHoverCustom"),
			isCustom: false,
		},
		bg: {
			input: document.getElementById("colorBg"),
			select: document.getElementById("colorBgSelect"),
			trigger: document.getElementById("colorBgTrigger"),
			caret: document.getElementById("colorBgCaret"),
			list: document.getElementById("colorBgList"),
			chip: document.getElementById("colorBgChip"),
			valueEl: document.getElementById("colorBgValue"),
			custom: document.getElementById("colorBgCustom"),
			isCustom: false,
		},
	};
	var COLOR_DEFAULTS = { fg: "#ffffff", hover: "#ffdd00", bg: "#000000" };
	var CUSTOM_COLOR_DEFAULT = "#cccccc";
	var previewWrap = document.querySelector(".danscii-preview-wrap");
	// Until the user picks a background colour, follow the site light/dark mode.
	var bgUserSelected = false;

	if (!mount || !form || typeof Danscii === "undefined") return;

	function isLightMode() {
		return document.documentElement.classList.contains("light-mode");
	}

	function modeBackground() {
		return isLightMode() ? "#ffffff" : "#000000";
	}

	function defaultColors() {
		var pool = PRIMARY_COLORS.slice();
		var fg = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
		var hover = pool[Math.floor(Math.random() * pool.length)];
		return { fg: fg, hover: hover, bg: modeBackground() };
	}

	function normalizeHex(raw) {
		var s = String(raw || "")
			.trim()
			.toLowerCase();
		if (!s) return null;
		if (s.charAt(0) !== "#") s = "#" + s;
		if (/^#[0-9a-f]{3}$/.test(s)) {
			s = "#" + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2) + s.charAt(3) + s.charAt(3);
		}
		return /^#[0-9a-f]{6}$/.test(s) ? s : null;
	}

	function formatHex(hex) {
		return String(hex || "").toUpperCase();
	}

	function closeAllSelects(except) {
		var opens = form.querySelectorAll(".danscii-select.is-open");
		for (var i = 0; i < opens.length; i++) {
			if (except && opens[i] === except) continue;
			opens[i].classList.remove("is-open");
			var expandables = opens[i].querySelectorAll("[aria-expanded]");
			for (var e = 0; e < expandables.length; e++) {
				expandables[e].setAttribute("aria-expanded", "false");
			}
			var list = opens[i].querySelector(".danscii-select-list");
			if (list) list.hidden = true;
		}
	}

	function openSelect(selectEl) {
		if (!selectEl) return;
		closeAllSelects(selectEl);
		selectEl.classList.add("is-open");
		var expandables = selectEl.querySelectorAll("[aria-expanded]");
		for (var e = 0; e < expandables.length; e++) {
			expandables[e].setAttribute("aria-expanded", "true");
		}
		var list = selectEl.querySelector(".danscii-select-list");
		if (list) list.hidden = false;
	}

	function syncColorField(key, hex, opts) {
		opts = opts || {};
		var field = colorFields[key];
		if (!field || !field.input) return;
		var normalized = normalizeHex(hex) || COLOR_DEFAULTS[key] || "#ffffff";
		var isCustom = false;
		if (opts.forceCustom) isCustom = true;
		else if (opts.fromPreset) isCustom = false;
		else isCustom = field.isCustom || !SITE_COLORS[normalized];

		field.isCustom = isCustom;
		field.input.value = normalized;
		if (field.chip) field.chip.style.setProperty("--chip", normalized);
		if (field.valueEl) {
			field.valueEl.hidden = isCustom;
			field.valueEl.textContent = formatHex(normalized);
		}
		if (field.custom) {
			field.custom.hidden = !isCustom;
			if (isCustom) field.custom.value = formatHex(normalized);
		}
		if (field.list) {
			var options = field.list.querySelectorAll('[role="option"]');
			for (var i = 0; i < options.length; i++) {
				var opt = options[i];
				var value = opt.getAttribute("data-value");
				var active = isCustom ? value === "custom" : value === normalized;
				opt.classList.toggle("is-active", active);
				opt.setAttribute("aria-selected", active ? "true" : "false");
			}
		}
	}

	function syncColorInputs(fg, hover, bg) {
		syncColorField("fg", fg, { fromPreset: true });
		syncColorField("hover", hover, { fromPreset: true });
		syncColorField("bg", bg != null ? bg : modeBackground(), { fromPreset: true });
	}

	function setColorFromOption(key, value) {
		var field = colorFields[key];
		if (!field) return;
		if (key === "bg") bgUserSelected = true;
		if (value === "custom") {
			syncColorField(key, CUSTOM_COLOR_DEFAULT, { forceCustom: true });
			closeAllSelects();
			if (field.custom) field.custom.focus();
			applyControls();
			return;
		}
		syncColorField(key, value, { fromPreset: true });
		closeAllSelects();
		applyControls();
	}

	function syncCharactersCustomVisibility(focusCustom) {
		var isCustom = charactersPreset && charactersPreset.value === "custom";
		if (charactersSelectValue) charactersSelectValue.hidden = isCustom;
		if (charactersCustom) {
			charactersCustom.hidden = !isCustom;
			if (isCustom && focusCustom) charactersCustom.focus();
		}
		if (charactersCustomNote) charactersCustomNote.hidden = !isCustom;
	}

	function syncCharactersSelectUi() {
		if (!charactersPreset || !charactersSelectList) return;
		var value = charactersPreset.value || DEFAULT_PRESET;
		var options = charactersSelectList.querySelectorAll('[role="option"]');
		var label = "Blocks";
		for (var i = 0; i < options.length; i++) {
			var opt = options[i];
			var active = opt.getAttribute("data-value") === value;
			opt.classList.toggle("is-active", active);
			opt.setAttribute("aria-selected", active ? "true" : "false");
			if (active) {
				var labelEl = opt.querySelector(".danscii-option-label");
				label = labelEl ? labelEl.textContent.trim() : opt.textContent.trim();
			}
		}
		if (charactersSelectValue && value !== "custom") {
			var valueLabel = charactersSelectValue.querySelector(".danscii-option-label");
			var valueChars = charactersSelectValue.querySelector(".danscii-option-chars");
			var chars = CHAR_PRESETS[value] || "";
			if (valueLabel && valueChars) {
				valueLabel.textContent = label;
				valueChars.textContent = chars;
				valueChars.hidden = !chars;
			} else {
				charactersSelectValue.textContent = label;
			}
		}
	}

	function setCharactersPreset(value, focusCustom) {
		if (!charactersPreset) return;
		charactersPreset.value = value;
		if (charactersCustom) {
			if (value === "custom") {
				var current = charactersCustom.value.trim();
				var isPresetRamp = false;
				for (var presetKey in CHAR_PRESETS) {
					if (CHAR_PRESETS[presetKey] === current) {
						isPresetRamp = true;
						break;
					}
				}
				if (current.length < 2 || isPresetRamp) charactersCustom.value = CUSTOM_CHARS;
			} else {
				charactersCustom.value = CHAR_PRESETS[value] || DEFAULT_CHARS;
			}
		}
		syncCharactersSelectUi();
		syncCharactersCustomVisibility(!!focusCustom);
		closeAllSelects();
		applyControls();
	}

	function readCharacters() {
		var preset = charactersPreset ? charactersPreset.value : DEFAULT_PRESET;
		if (preset === "custom") {
			var custom = (charactersCustom && charactersCustom.value.trim()) || "";
			return custom.length >= 2 ? custom : CUSTOM_CHARS;
		}
		return CHAR_PRESETS[preset] || DEFAULT_CHARS;
	}

	function readControls() {
		var thr = Number(form.threshold && form.threshold.value);
		return {
			characters: readCharacters(),
			density: Number(form.density.value) || 120,
			threshold: Number.isFinite(thr) ? Math.max(0, Math.min(70, thr)) : 0,
			fg: form.colorFg.value || COLOR_DEFAULTS.fg,
			hover: form.colorHover.value || COLOR_DEFAULTS.hover,
			bg: (form.colorBg && form.colorBg.value) || modeBackground(),
			hoverCells: (function () {
				var n = Number(form.hoverCells && form.hoverCells.value);
				return n === 2 || n === 6 ? n : 4;
			})(),
			persistHover: !!(form.persistHover && form.persistHover.value === "1"),
		};
	}

	function hoverSizeLabel(n) {
		if (n <= 2) return "Small";
		if (n >= 6) return "Large";
		return "Medium";
	}

	var currentImageLabel = "dan-newman.jpg";

	function escapeHtml(str) {
		return String(str)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	function updateSettingsStatus() {
		if (!statusEl) return;
		var c = readControls();
		var rows = [
			["Characters", c.characters],
			["Glyphs Colour", formatHex(c.fg)],
			["Hover Colour", formatHex(c.hover)],
			["Background Colour", formatHex(c.bg)],
			["Density", String(c.density)],
			["Threshold", String(c.threshold)],
			["Hover trail", c.persistHover ? "Keep" : "Fade"],
			["Hover size", hoverSizeLabel(c.hoverCells)],
			["File", currentImageLabel],
		];
		statusEl.innerHTML = rows
			.map(function (row) {
				return "<dt>" + escapeHtml(row[0]) + "</dt><dd>" + escapeHtml(row[1]) + "</dd>";
			})
			.join("");
	}

	function densityForPageSize() {
		var w = mount && mount.clientWidth;
		if (!w || w < 40) {
			// Preview is ~60% of the lab row before layout settles.
			w = Math.round((window.innerWidth || 960) * 0.55);
		}
		// Map preview width → density (slider range 40–320, step 10).
		var d = Math.round(w / 9 / 10) * 10;
		return Math.max(40, Math.min(320, d));
	}

	function setDensityControl(density) {
		form.density.value = String(density);
		var label = document.getElementById("density-val");
		if (label) label.textContent = String(density);
	}

	function setThresholdControl(n) {
		var v = Number.isFinite(n) ? Math.max(0, Math.min(70, n)) : 0;
		if (form.threshold) form.threshold.value = String(v);
		var label = document.getElementById("threshold-val");
		if (label) label.textContent = String(v);
	}

	var defaults = defaultColors();
	syncColorInputs(defaults.fg, defaults.hover, defaults.bg);
	if (charactersPreset) charactersPreset.value = DEFAULT_PRESET;
	if (charactersCustom) charactersCustom.value = CUSTOM_CHARS;
	syncCharactersSelectUi();
	syncCharactersCustomVisibility();
	setDensityControl(densityForPageSize());
	setThresholdControl(0);

	var controls = readControls();
	var art = new Danscii(mount, {
		src: DEFAULT_SRC,
		mode: "dark",
		fg: controls.fg,
		hover: controls.hover,
		density: controls.density,
		densityBreakpoints: null,
		threshold: controls.threshold,
		characters: controls.characters,
		hoverCells: controls.hoverCells,
		persistHover: controls.persistHover,
		fontFamily: '"Berkeley Mono", monospace',
	});
	// Re-measure after layout so density matches the real preview width.
	requestAnimationFrame(function () {
		var d = densityForPageSize();
		setDensityControl(d);
		art.setDensity(d);
		updateSettingsStatus();
	});

	function applyControls() {
		var c = readControls();
		var densityLabel = document.getElementById("density-val");
		var thresholdLabel = document.getElementById("threshold-val");
		if (densityLabel) densityLabel.textContent = String(c.density);
		if (thresholdLabel) thresholdLabel.textContent = String(c.threshold);
		art.setCharacters(c.characters);
		art.setDensity(c.density);
		art.setThreshold(c.threshold);
		art.setColors(c.fg, c.hover);
		art.setHoverCells(c.hoverCells);
		art.setPersistHover(c.persistHover);
		if (previewWrap) previewWrap.style.background = c.bg;
		updateSettingsStatus();
	}

	form.addEventListener("input", applyControls);
	form.addEventListener("change", applyControls);

	function syncBgToMode() {
		if (bgUserSelected) return;
		var next = modeBackground();
		var current = normalizeHex(colorFields.bg.input && colorFields.bg.input.value);
		if (current === next) return;
		syncColorField("bg", next, { fromPreset: true });
		applyControls();
	}

	if (typeof MutationObserver !== "undefined") {
		var modeObserver = new MutationObserver(syncBgToMode);
		modeObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class"],
		});
	}

	if (charactersSelect && charactersSelectList) {
		function toggleCharactersSelect() {
			if (charactersSelect.classList.contains("is-open")) closeAllSelects();
			else openSelect(charactersSelect);
		}

		if (charactersSelectCaret) {
			charactersSelectCaret.addEventListener("click", function (e) {
				e.preventDefault();
				e.stopPropagation();
				toggleCharactersSelect();
			});
		}

		if (charactersSelectTrigger) {
			charactersSelectTrigger.addEventListener("click", function (e) {
				if (
					e.target.closest(".danscii-characters-custom") ||
					e.target.closest(".danscii-color-caret")
				) {
					return;
				}
				if (charactersPreset && charactersPreset.value === "custom") return;
				e.preventDefault();
				toggleCharactersSelect();
			});
		}

		charactersSelectList.addEventListener("click", function (e) {
			var option = e.target.closest('[role="option"]');
			if (!option || !charactersSelectList.contains(option)) return;
			setCharactersPreset(
				option.getAttribute("data-value"),
				option.getAttribute("data-value") === "custom",
			);
		});

		if (charactersCustom) {
			charactersCustom.addEventListener("click", function (e) {
				e.stopPropagation();
			});
		}
	}

	["fg", "hover", "bg"].forEach(function (key) {
		var field = colorFields[key];
		if (!field || !field.select || !field.list) return;

		function toggleColorSelect() {
			if (field.select.classList.contains("is-open")) closeAllSelects();
			else openSelect(field.select);
		}

		if (field.caret) {
			field.caret.addEventListener("click", function (e) {
				e.preventDefault();
				e.stopPropagation();
				toggleColorSelect();
			});
		}

		if (field.trigger) {
			field.trigger.addEventListener("click", function (e) {
				if (e.target.closest(".danscii-color-custom") || e.target.closest(".danscii-color-caret")) {
					return;
				}
				if (field.isCustom) return;
				e.preventDefault();
				toggleColorSelect();
			});
		}

		field.list.addEventListener("click", function (e) {
			var option = e.target.closest('[role="option"]');
			if (!option || !field.list.contains(option)) return;
			setColorFromOption(key, option.getAttribute("data-value"));
		});

		if (field.custom) {
			field.custom.addEventListener("click", function (e) {
				e.stopPropagation();
			});
			field.custom.addEventListener("input", function () {
				var hex = normalizeHex(field.custom.value);
				if (!hex) return;
				if (key === "bg") bgUserSelected = true;
				field.isCustom = true;
				field.input.value = hex;
				if (field.chip) field.chip.style.setProperty("--chip", hex);
				applyControls();
			});
			field.custom.addEventListener("change", function () {
				var hex = normalizeHex(field.custom.value);
				if (!hex) {
					field.custom.value = formatHex(field.input.value);
					return;
				}
				if (key === "bg") bgUserSelected = true;
				if (SITE_COLORS[hex]) syncColorField(key, hex, { fromPreset: true });
				else syncColorField(key, hex, { forceCustom: true });
				applyControls();
			});
		}
	});

	document.addEventListener("click", function (e) {
		if (!e.target.closest(".danscii-select")) closeAllSelects();
	});

	document.addEventListener("keydown", function (e) {
		if (e.key === "Escape") closeAllSelects();
	});

	function setFileError(msg) {
		if (!fileErrorEl) return;
		if (msg) {
			fileErrorEl.hidden = false;
			fileErrorEl.textContent = msg;
		} else {
			fileErrorEl.hidden = true;
			fileErrorEl.textContent = "";
		}
	}

	function isAllowedImageFile(file) {
		var name = (file.name || "").toLowerCase();
		var type = (file.type || "").toLowerCase();
		var okExt = /\.(png|jpe?g)$/.test(name);
		var okType = type === "image/png" || type === "image/jpeg" || type === "";
		return okExt && okType;
	}

	if (fileInput) {
		fileInput.addEventListener("change", function () {
			var file = fileInput.files && fileInput.files[0];
			if (!file) {
				setFileError("");
				return;
			}
			if (!isAllowedImageFile(file)) {
				fileInput.value = "";
				setFileError("Only .png or .jpg files are supported.");
				return;
			}
			if (file.size > MAX_FILE_BYTES) {
				fileInput.value = "";
				setFileError("File size too large. Max " + MAX_FILE_LABEL + ".");
				return;
			}
			setFileError("");
			if (objectUrl) {
				try {
					URL.revokeObjectURL(objectUrl);
				} catch (err) {}
			}
			objectUrl = URL.createObjectURL(file);
			currentImageFile = file;
			currentImageLabel = file.name;
			art.setSrc(objectUrl);
			updateSettingsStatus();
		});
	}

	if (resetBtn) {
		resetBtn.addEventListener("click", function () {
			if (objectUrl) {
				try {
					URL.revokeObjectURL(objectUrl);
				} catch (err) {}
				objectUrl = null;
			}
			currentImageFile = null;
			if (fileInput) fileInput.value = "";
			setFileError("");
			currentImageLabel = "dan-newman.jpg";
			if (charactersPreset) charactersPreset.value = DEFAULT_PRESET;
			if (charactersCustom) charactersCustom.value = CUSTOM_CHARS;
			syncCharactersSelectUi();
			syncCharactersCustomVisibility();
			closeAllSelects();
			setDensityControl(densityForPageSize());
			setThresholdControl(0);
			bgUserSelected = false;
			var resetColors = defaultColors();
			syncColorInputs(resetColors.fg, resetColors.hover, resetColors.bg);
			var hoverRadios = form.querySelectorAll('input[name="hoverCells"]');
			for (var h = 0; h < hoverRadios.length; h++) {
				hoverRadios[h].checked = hoverRadios[h].value === "4";
			}
			var persistRadios = form.querySelectorAll('input[name="persistHover"]');
			for (var i = 0; i < persistRadios.length; i++) {
				persistRadios[i].checked = persistRadios[i].value === "1";
			}
			art.setSrc(DEFAULT_SRC);
			applyControls();
		});
	}

	function escapeAttr(str) {
		return String(str).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
	}

	function escapeInlineScript(text) {
		// HTML parsers close <script> at the first </script>, even inside JS comments/strings.
		return String(text).replace(/<\/script/gi, "<\\/script");
	}

	function safeImageName(name) {
		var base = String(name || "image.jpg")
			.split(/[/\\]/)
			.pop()
			.replace(/[^\w.\-()+ ]+/g, "-")
			.replace(/\s+/g, "-")
			.replace(/-+/g, "-");
		if (!/\.(jpe?g|png)$/i.test(base)) base += ".jpg";
		if (base.length > 80) {
			var ext = (base.match(/\.(jpe?g|png)$/i) || [".jpg"])[0];
			base = base.slice(0, 80 - ext.length) + ext;
		}
		return base || "image.jpg";
	}

	function buildDownloadHtml(source, imageName) {
		var c = readControls();
		var chars = c.characters;
		var pageBg = (c.bg || COLOR_DEFAULTS.bg).toLowerCase();
		var pageFg = pageBg === "#ffffff" ? "#000000" : "#f2f2ef";
		return [
			"<!DOCTYPE html>",
			"<!--",
			"  D@N5C1I (APP) — Animated ASCII Art Generator by Dan Newman",
			"  https://dan.newman.is/building/danscii/",
			"",
			"  Setup:",
			"  1. Keep this HTML next to " + imageName + " (same folder).",
			"  2. Host the folder on your site — it should Just Work.",
			"  3. Opening from disk: use the LOCAL ONLY chooser (or a local server).",
			"  4. Optional: delete the LOCAL ONLY block once you’re hosting.",
			"",
			"-->",
			'<html lang="en">',
			"<head>",
			'<meta charset="utf-8" />',
			"<title>D@N5C1I (APP)</title>",
			'<meta name="viewport" content="width=device-width, initial-scale=1" />',
			'<meta name="author" content="Dan Newman" />',
			"<style>",
			"  html, body {",
			"    margin: 0; min-height: 100%; background: " + pageBg + "; color: " + pageFg + ";",
			'    font-family: "Berkeley Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;',
			"    font-size: 11px; line-height: 1.5;",
			"  }",
			"  .wrap { margin: 0; padding: 24px; }",
			"  .notes { margin: 1.25rem 0 0; text-align: left; color: " + escapeAttr(c.fg) + "; }",
			"  .notes p { margin: 0 0 0.65rem; opacity: 0.55; }",
			"  .notes p:last-child { margin-bottom: 0; }",
			"  .notes a { color: inherit; }",
			"  .notes a:hover { color: " + escapeAttr(c.hover) + "; opacity: 1; }",
			"  .local-only {",
			"    display: none; margin: 0 0 1.25rem; max-width: 34rem;",
			"    color: " + escapeAttr(c.fg) + ";",
			"  }",
			"  .local-only.is-visible { display: block; }",
			"  .local-only h1 { margin: 0 0 0.65rem; font-size: 22px; font-weight: 400; line-height: 1.2; }",
			"  .local-only h1 .tint { opacity: 0.25; }",
			"  .local-only .tag {",
			"    display: inline-block; margin: 0 0 0.5rem;",
			"    letter-spacing: 0.04em; text-transform: uppercase; opacity: 0.75;",
			"  }",
			"  .local-only p { margin: 0 0 0.75rem; opacity: 0.55; }",
			"  .local-only .divider {",
			"    margin: 1.25rem 0; border: 0; border-top: 1px solid " +
				escapeAttr(c.fg) +
				"; opacity: 0.35;",
			"  }",
			"  .local-only label { display: block; margin: 0.4rem 0 0; opacity: 0.25; text-transform: uppercase; }",
			"  .local-only .file-error { margin: 0.35rem 0 0; opacity: 0.75; }",
			"  .local-only .file-error[hidden] { display: none; }",
			"  .local-only input[type='file'] {",
			"    width: 100%; box-sizing: border-box; min-height: 2.1rem;",
			"    background: transparent; border: 0; border-radius: 0;",
			"    color: " + escapeAttr(c.fg) + "; font: inherit; padding: 0.35rem 0;",
			"  }",
			"  .local-only input[type='file']::file-selector-button,",
			"  .local-only input[type='file']::-webkit-file-upload-button {",
			"    -webkit-appearance: none; appearance: none;",
			"    margin: 0 0.85rem 0 0; padding: 0.25rem 0.5rem;",
			"    border: 1px solid " + escapeAttr(c.fg) + "; border-radius: 0; background: transparent;",
			"    color: " + escapeAttr(c.fg) + "; font: inherit; cursor: pointer;",
			"  }",
			"  .local-only input[type='file']::file-selector-button:hover,",
			"  .local-only input[type='file']::-webkit-file-upload-button:hover {",
			"    color: " + escapeAttr(c.hover) + "; border-color: " + escapeAttr(c.hover) + ";",
			"  }",
			"  #danscii { width: 100%; }",
			"  code { opacity: 0.85; }",
			"</style>",
			"</head>",
			"<body>",
			'<div class="wrap">',
			"  <!-- LOCAL ONLY: shown when opened from disk; safe to delete when hosting -->",
			'  <div class="local-only" id="local-only">',
			'    <h1>D@N5C1I <span class="tint">(APP)</span></h1>',
			'    <hr class="divider" />',
			'    <div class="tag">Delete this section when adding to your site:</div>',
			"    <p>Browsers block the image loading from this file when opening from your computer. Choose <code>" +
				escapeAttr(imageName) +
				"</code> from this folder to preview your ASCII.</p>",
			'    <hr class="divider" />',
			'    <input type="file" id="danscii-file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" />',
			'    <label for="danscii-file">(.png or .jpg, max 5 MB)</label>',
			'    <p class="file-error" id="danscii-file-error" hidden></p>',
			"  </div>",
			"  <!-- /LOCAL ONLY -->",
			'  <div id="danscii"></div>',
			'  <div class="notes">',
			'    <p>Made with <a href="https://dan.newman.is/building/danscii/">D@N5C1I</a> by <a href="https://dan.newman.is/">Dan Newman</a>. \\m/</p>',
			"  </div>",
			"</div>",
			"<script>",
			escapeInlineScript(source),
			"</script>",
			"<script>",
			escapeInlineScript(
				[
					"(function () {",
					"  var local = document.getElementById('local-only');",
					"  var pick = document.getElementById('danscii-file');",
					"  var fileError = document.getElementById('danscii-file-error');",
					"  var localUrl = null;",
					"  var MAX_FILE_BYTES = 5 * 1024 * 1024;",
					"  function showLocal() {",
					"    if (local) local.classList.add('is-visible');",
					"  }",
					"  function hideLocal() {",
					"    if (local) local.classList.remove('is-visible');",
					"  }",
					"  function setFileError(msg) {",
					"    if (!fileError) return;",
					"    if (msg) {",
					"      fileError.textContent = msg;",
					"      fileError.hidden = false;",
					"    } else {",
					"      fileError.textContent = '';",
					"      fileError.hidden = true;",
					"    }",
					"  }",
					"  var art = new Danscii(document.getElementById('danscii'), {",
					"    src: " + JSON.stringify(imageName) + ",",
					"    fg: '" + escapeAttr(c.fg) + "',",
					"    hover: '" + escapeAttr(c.hover) + "',",
					"    density: " + Number(c.density) + ",",
					"    densityBreakpoints: null,",
					"    threshold: " + Number(c.threshold) + ",",
					"    characters: " + JSON.stringify(chars) + ",",
					"    hoverCells: " + Number(c.hoverCells) + ",",
					"    persistHover: " + (c.persistHover ? "true" : "false") + ",",
					"    fontFamily: '\"Berkeley Mono\", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',",
					"    onImageError: showLocal,",
					"    onImageReady: hideLocal",
					"  });",
					"  if (pick) {",
					"    pick.addEventListener('change', function () {",
					"      var file = pick.files && pick.files[0];",
					"      if (!file) return;",
					"      var name = (file.name || '').toLowerCase();",
					"      var okType = /\\.(png|jpe?g)$/.test(name) ||",
					"        file.type === 'image/png' || file.type === 'image/jpeg';",
					"      if (!okType) {",
					"        pick.value = '';",
					"        setFileError('Only .png or .jpg files are supported.');",
					"        return;",
					"      }",
					"      if (file.size > MAX_FILE_BYTES) {",
					"        pick.value = '';",
					"        setFileError('File size too large. Max 5 MB.');",
					"        return;",
					"      }",
					"      setFileError('');",
					"      if (localUrl) {",
					"        try { URL.revokeObjectURL(localUrl); } catch (e) {}",
					"      }",
					"      localUrl = URL.createObjectURL(file);",
					"      art.setSrc(localUrl);",
					"    });",
					"  }",
					"})();",
				].join("\n"),
			),
			"</script>",
			"</body>",
			"</html>",
			"",
		].join("\n");
	}

	function concatBytes(chunks) {
		var total = 0;
		for (var i = 0; i < chunks.length; i++) total += chunks[i].length;
		var out = new Uint8Array(total);
		var offset = 0;
		for (var j = 0; j < chunks.length; j++) {
			out.set(chunks[j], offset);
			offset += chunks[j].length;
		}
		return out;
	}

	function u16le(n) {
		return new Uint8Array([n & 255, (n >>> 8) & 255]);
	}

	function u32le(n) {
		return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
	}

	function crc32(data) {
		var table = crc32._table;
		if (!table) {
			table = crc32._table = new Uint32Array(256);
			for (var i = 0; i < 256; i++) {
				var c = i;
				for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
				table[i] = c >>> 0;
			}
		}
		var crc = 0xffffffff;
		for (var i = 0; i < data.length; i++) {
			crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
		}
		return (crc ^ 0xffffffff) >>> 0;
	}

	// Minimal store-only zip (no compression) — fine for HTML + jpg/png.
	function buildZipBlob(files) {
		var encoder = new TextEncoder();
		var locals = [];
		var centrals = [];
		var offset = 0;
		for (var i = 0; i < files.length; i++) {
			var nameBytes = encoder.encode(files[i].name);
			var data = files[i].data;
			var crc = crc32(data);
			var local = concatBytes([
				u32le(0x04034b50),
				u16le(20),
				u16le(0),
				u16le(0),
				u16le(0),
				u16le(0),
				u32le(crc),
				u32le(data.length),
				u32le(data.length),
				u16le(nameBytes.length),
				u16le(0),
				nameBytes,
				data,
			]);
			centrals.push(
				concatBytes([
					u32le(0x02014b50),
					u16le(20),
					u16le(20),
					u16le(0),
					u16le(0),
					u16le(0),
					u16le(0),
					u32le(crc),
					u32le(data.length),
					u32le(data.length),
					u16le(nameBytes.length),
					u16le(0),
					u16le(0),
					u16le(0),
					u16le(0),
					u32le(0),
					u32le(offset),
					nameBytes,
				]),
			);
			locals.push(local);
			offset += local.length;
		}
		var centralDir = concatBytes(centrals);
		var end = concatBytes([
			u32le(0x06054b50),
			u16le(0),
			u16le(0),
			u16le(files.length),
			u16le(files.length),
			u32le(centralDir.length),
			u32le(offset),
			u16le(0),
		]);
		return new Blob([concatBytes(locals.concat([centralDir, end]))], {
			type: "application/zip",
		});
	}

	function ensureModuleSource() {
		if (moduleSource) return Promise.resolve(moduleSource);
		return fetch("/filing/v5/js/danscii.js")
			.then(function (res) {
				if (!res.ok) throw new Error("Could not load danscii.js");
				return res.text();
			})
			.then(function (text) {
				moduleSource = text;
				return moduleSource;
			});
	}

	function getImageForZip() {
		if (currentImageFile) {
			return Promise.resolve({
				name: safeImageName(currentImageFile.name),
				blob: currentImageFile,
			});
		}
		return fetch(DEFAULT_SRC).then(function (res) {
			if (!res.ok) throw new Error("Could not pack default image");
			return res.blob().then(function (blob) {
				return { name: "dan-newman.jpg", blob: blob };
			});
		});
	}

	function blobToUint8Array(blob) {
		return blob.arrayBuffer().then(function (buf) {
			return new Uint8Array(buf);
		});
	}

	if (downloadBtn) {
		downloadBtn.addEventListener("click", function () {
			Promise.all([ensureModuleSource(), getImageForZip()])
				.then(function (results) {
					var source = results[0];
					var image = results[1];
					var html = buildDownloadHtml(source, image.name);
					var encoder = new TextEncoder();
					return blobToUint8Array(image.blob).then(function (imageBytes) {
						var zip = buildZipBlob([
							{ name: "danscii/index.html", data: encoder.encode(html) },
							{ name: "danscii/" + image.name, data: imageBytes },
						]);
						var url = URL.createObjectURL(zip);
						var a = document.createElement("a");
						a.href = url;
						a.download = "danscii.zip";
						document.body.appendChild(a);
						a.click();
						a.remove();
						setTimeout(function () {
							URL.revokeObjectURL(url);
						}, 1000);
					});
				})
				.catch(function (err) {
					console.error(err);
				});
		});
	}

	if (exportBtn) {
		exportBtn.addEventListener("click", function () {
			var c = readControls();
			var canvas = art.exportCanvas({ scale: 2, background: c.bg });
			if (!canvas) return;
			var base = String(currentImageLabel || "danscii")
				.replace(/\.[^.]+$/, "")
				.replace(/[^\w.\-()+ ]+/g, "-")
				.replace(/\s+/g, "-");
			if (!base) base = "danscii";
			canvas.toBlob(function (blob) {
				if (!blob) return;
				var url = URL.createObjectURL(blob);
				var a = document.createElement("a");
				a.href = url;
				a.download = base + "-danscii.png";
				document.body.appendChild(a);
				a.click();
				a.remove();
				setTimeout(function () {
					URL.revokeObjectURL(url);
				}, 1000);
			}, "image/png");
		});
	}

	function startTitleGlitch() {
		var el = document.getElementById("danscii-title");
		if (!el) return;
		var A = "D@N5C1I";
		var B = "DANSCII";
		var POOL = "@#%*+=-:.,;'\"^~<>[]{}()/\\|ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
		var len = A.length;
		var mode = []; // 0 = A, 1 = B
		var display = [];
		var settle = [];
		var target = [];
		var settleTick = 0;
		var i;
		for (i = 0; i < len; i++) {
			mode[i] = 0;
			display[i] = " ";
			settle[i] = 0;
			target[i] = A.charAt(i);
		}

		function glyph() {
			return POOL.charAt((Math.random() * POOL.length) | 0);
		}

		function render() {
			el.textContent = display.join("");
		}

		function beginSettle(idx, nextMode, frames) {
			mode[idx] = nextMode;
			target[idx] = nextMode ? B.charAt(idx) : A.charAt(idx);
			settle[idx] = frames != null ? frames : 6 + ((Math.random() * 10) | 0);
			display[idx] = glyph();
		}

		if (
			typeof matchMedia === "function" &&
			matchMedia("(prefers-reduced-motion: reduce)").matches
		) {
			for (i = 0; i < len; i++) display[i] = A.charAt(i);
			render();
			return;
		}

		// Intro: stagger each letter through random glyphs into D@N5C1I
		for (i = 0; i < len; i++) {
			(function (idx) {
				setTimeout(
					function () {
						beginSettle(idx, 0, 10 + ((Math.random() * 12) | 0));
					},
					idx * 110 + ((Math.random() * 60) | 0),
				);
			})(i);
		}

		var idleAcc = 0;
		var last = performance.now();

		function frame(now) {
			var dt = Math.min(0.05, (now - last) / 1000);
			last = now;
			var changed = false;

			// ~30fps settle updates so glyphs linger a bit longer
			settleTick += dt;
			if (settleTick >= 1 / 30) {
				settleTick = 0;
				for (i = 0; i < len; i++) {
					if (settle[i] <= 0) continue;
					settle[i]--;
					changed = true;
					if (settle[i] === 0) {
						display[i] = target[i];
					} else if (Math.random() < 0.55) {
						display[i] = glyph();
					}
				}
			}

			// After intro, randomly glitch slots between the two title states
			idleAcc += dt;
			if (idleAcc > 0.22) {
				idleAcc = 0;
				var settling = false;
				for (i = 0; i < len; i++) {
					if (settle[i] > 0) {
						settling = true;
						break;
					}
				}
				if (!settling && Math.random() < 0.35) {
					var flips = 1 + ((Math.random() * 2) | 0);
					for (var f = 0; f < flips; f++) {
						var idx = (Math.random() * len) | 0;
						if (settle[idx] > 0) continue;
						beginSettle(idx, mode[idx] ? 0 : 1);
					}
					// Occasionally pull everything back toward D@N5C1I
					if (Math.random() < 0.1) {
						for (i = 0; i < len; i++) {
							if (mode[i] !== 0 || display[i] !== A.charAt(i)) {
								beginSettle(i, 0, 5 + ((Math.random() * 6) | 0));
							}
						}
					}
					changed = true;
				}
			}

			if (changed) render();
			requestAnimationFrame(frame);
		}

		render();
		requestAnimationFrame(frame);
	}

	ensureModuleSource().catch(function () {});
	applyControls();
	startTitleGlitch();
})();
