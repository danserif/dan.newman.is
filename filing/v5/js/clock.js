(function () {
	var SVG_NS = "http://www.w3.org/2000/svg";
	var CX = 100,
		CY = 100;
	var IDLE_MS = 60000;
	var isHome = window.location.pathname === "/" || window.location.pathname === "/index.html";

	var overlay = document.createElement("div");
	overlay.id = "clock-overlay";

	var svg = document.createElementNS(SVG_NS, "svg");
	svg.id = "clock-svg";
	svg.setAttribute("viewBox", "0 0 200 200");

	var markersG = document.createElementNS(SVG_NS, "g");
	var numeralsG = document.createElementNS(SVG_NS, "g");

	var logoG = document.createElementNS(SVG_NS, "g");
	logoG.setAttribute("class", "clock-logo");
	logoG.setAttribute("transform", "translate(100, 64) scale(0.275) translate(-54.5, -41)");
	var pathAN = document.createElementNS(SVG_NS, "path");
	pathAN.setAttribute(
		"d",
		"M80 31.7v49.9h9V34.1c0-4.3 4.1-4.7 5.5-4.7s5.5.3 5.5 4.7v47.5h9V31.7c0-10.4-11.4-11.3-14.5-11.3S80 21.3 80 31.7zM71.7 81.7v-69c0-10.4-13.1-12-16.3-12s-16.3 1.6-16.3 12v69h9.7V56.1H62v25.6h9.7zm-22.9-36V15.1c0-4.3 5.1-4.7 6.6-4.7s6.6.3 6.6 4.7v30.6H48.8z",
	);
	var pathD = document.createElementNS(SVG_NS, "path");
	pathD.setAttribute("fill-rule", "evenodd");
	pathD.setAttribute(
		"d",
		"M.4 52.7v-31h16.2c4.7 0 14.3 1.2 14.3 14.4v31.2c0 13.2-9.6 14.4-14.3 14.4H.4v-29zm9.7-.1v-23h4.7c3 0 6.4.2 6.4 8.9v25.9c0 8.7-3.4 8.9-6.4 8.9h-4.7V52.6z",
	);
	logoG.appendChild(pathAN);
	logoG.appendChild(pathD);

	var tzText = document.createElementNS(SVG_NS, "text");
	tzText.setAttribute("class", "clock-tz");
	tzText.setAttribute("x", "100");
	tzText.setAttribute("y", "81");

	var tzParts = new Intl.DateTimeFormat("en-NZ", {
		timeZone: "Pacific/Auckland",
		timeZoneName: "short",
	}).formatToParts(new Date());
	for (var t = 0; t < tzParts.length; t++) {
		if (tzParts[t].type === "timeZoneName") {
			tzText.textContent = tzParts[t].value;
			break;
		}
	}

	var hourHand = document.createElementNS(SVG_NS, "line");
	hourHand.id = "clock-hour";
	hourHand.setAttribute("class", "clock-hand-hour");
	hourHand.setAttribute("x1", "100");
	hourHand.setAttribute("y1", "100");
	hourHand.setAttribute("x2", "100");
	hourHand.setAttribute("y2", "48");

	var minuteHand = document.createElementNS(SVG_NS, "line");
	minuteHand.id = "clock-minute";
	minuteHand.setAttribute("class", "clock-hand-minute");
	minuteHand.setAttribute("x1", "100");
	minuteHand.setAttribute("y1", "100");
	minuteHand.setAttribute("x2", "100");
	minuteHand.setAttribute("y2", "28");

	var secondGroup = document.createElementNS(SVG_NS, "g");
	secondGroup.id = "clock-second-group";
	var secondLine = document.createElementNS(SVG_NS, "line");
	secondLine.setAttribute("class", "clock-hand-second");
	secondLine.setAttribute("x1", "100");
	secondLine.setAttribute("y1", "112");
	secondLine.setAttribute("x2", "100");
	secondLine.setAttribute("y2", "24");
	secondGroup.appendChild(secondLine);

	var cap = document.createElementNS(SVG_NS, "circle");
	cap.setAttribute("class", "clock-cap");
	cap.setAttribute("cx", "100");
	cap.setAttribute("cy", "100");
	cap.setAttribute("r", "4");

	svg.appendChild(markersG);
	svg.appendChild(numeralsG);
	svg.appendChild(logoG);
	svg.appendChild(tzText);
	svg.appendChild(hourHand);
	svg.appendChild(minuteHand);
	svg.appendChild(secondGroup);
	svg.appendChild(cap);
	overlay.appendChild(svg);
	document.body.appendChild(overlay);

	function polar(angle, radius) {
		var rad = ((angle - 90) * Math.PI) / 180;
		return { x: CX + radius * Math.cos(rad), y: CY + radius * Math.sin(rad) };
	}

	for (var i = 0; i < 60; i++) {
		var angle = i * 6;
		var isHour = i % 5 === 0;
		var inner = polar(angle, isHour ? 78 : 82);
		var outerR = isHour ? 88.55 : 88;
		var outer = polar(angle, outerR);
		var line = document.createElementNS(SVG_NS, "line");
		line.setAttribute("x1", inner.x.toFixed(2));
		line.setAttribute("y1", inner.y.toFixed(2));
		line.setAttribute("x2", outer.x.toFixed(2));
		line.setAttribute("y2", outer.y.toFixed(2));
		line.setAttribute(
			"class",
			"clock-marker " + (isHour ? "clock-marker-hour" : "clock-marker-minute"),
		);
		markersG.appendChild(line);
	}

	for (var n = 1; n <= 12; n++) {
		var a = n * 30;
		var p = polar(a, 65.5);
		var txt = document.createElementNS(SVG_NS, "text");
		txt.setAttribute("x", p.x.toFixed(2));
		txt.setAttribute("y", p.y.toFixed(2));
		txt.setAttribute("class", "clock-numeral");
		txt.textContent = n;
		numeralsG.appendChild(txt);
	}

	var clockRAF = null;

	function getNZTime() {
		var s = new Date().toLocaleString("en-US", {
			timeZone: "Pacific/Auckland",
			hour12: false,
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
		var parts = s.split(":");
		return {
			h: parseInt(parts[0], 10),
			m: parseInt(parts[1], 10),
			s: parseInt(parts[2], 10),
		};
	}

	function updateClock() {
		var t = getNZTime();
		var secAngle = t.s * 6;
		var minAngle = t.m * 6 + t.s * 0.1;
		var hourAngle = (t.h % 12) * 30 + t.m * 0.5;
		hourHand.setAttribute("transform", "rotate(" + hourAngle + " 100 100)");
		minuteHand.setAttribute("transform", "rotate(" + minAngle + " 100 100)");
		secondGroup.setAttribute("transform", "rotate(" + secAngle + " 100 100)");
		clockRAF = requestAnimationFrame(updateClock);
	}

	function openClock(fromIdle) {
		overlay.classList.toggle("clock-idle", !!fromIdle && !isHome);
		overlay.classList.add("is-open");
		updateClock();
	}

	function closeClock() {
		overlay.classList.remove("is-open");
		if (clockRAF) {
			cancelAnimationFrame(clockRAF);
			clockRAF = null;
		}
		setTimeout(function () {
			overlay.classList.remove("clock-idle");
		}, 300);
		resetIdle();
	}

	overlay.addEventListener("click", function (e) {
		if (e.target === overlay) closeClock();
	});

	document.addEventListener("keydown", function (e) {
		if (e.key === "Escape" && overlay.classList.contains("is-open")) closeClock();
	});

	var nzTimeLink = document.getElementById("nz-time-link");
	var nzTime = nzTimeLink || document.getElementById("nz-time");
	if (nzTime) {
		nzTime.addEventListener("click", function (e) {
			e.preventDefault();
			e.stopPropagation();
			openClock(!isHome);
		});
	}

	var idleTimer = null;
	function resetIdle() {
		clearTimeout(idleTimer);
		idleTimer = setTimeout(function () {
			if (!overlay.classList.contains("is-open")) openClock(true);
		}, IDLE_MS);
	}

	["mousemove", "mousedown", "keydown", "touchstart", "scroll"].forEach(function (evt) {
		document.addEventListener(evt, resetIdle, { passive: true });
	});
	resetIdle();
})();
