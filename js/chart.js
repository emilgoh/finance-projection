/**
 * Interactive SVG line chart for the projection: two series (nominal + real
 * net worth), hairline grid, crosshair + tooltip, retirement marker, direct
 * end labels. Colors are read from CSS custom properties at render time so
 * light/dark mode swaps automatically.
 */
const NS = "http://www.w3.org/2000/svg";

export function renderChart(container, result, opts) {
  container.textContent = "";
  const rows = result.rows;
  if (rows.length < 2) return () => {};

  const css = getComputedStyle(document.documentElement);
  const color = (name) => css.getPropertyValue(name).trim();
  const C = {
    nominal: color("--series-nominal"),
    real: color("--series-real"),
    grid: color("--gridline"),
    baseline: color("--baseline"),
    muted: color("--text-muted"),
    ink: color("--text-primary"),
    surface: color("--surface-1"),
  };

  const width = Math.max(320, container.clientWidth || 640);
  const height = 380;
  const m = { top: 26, right: 14, bottom: 48, left: 62 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;

  const svg = el("svg", {
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    "aria-hidden": "true",
  });

  // scales
  const x0 = rows[0].age;
  const x1 = rows[rows.length - 1].age;
  let yMax = 0;
  let yMin = 0;
  for (const row of rows) {
    if (row.nominal > yMax) yMax = row.nominal;
    if (row.nominal < yMin) yMin = row.nominal;
  }
  yMax = yMax <= 0 ? 1 : yMax * 1.06;
  const X = (age) => m.left + ((age - x0) / (x1 - x0)) * plotW;
  const Y = (v) => m.top + ((yMax - v) / (yMax - yMin)) * plotH;

  // gridlines + y ticks (clean numbers, hairline solid)
  const yStep = niceStep((yMax - yMin) / 5);
  for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax; v += yStep) {
    const y = Y(v);
    svg.append(el("line", {
      x1: m.left, x2: m.left + plotW, y1: y, y2: y,
      stroke: v === 0 ? C.baseline : C.grid, "stroke-width": 1,
    }));
    svg.append(text(m.left - 8, y + 4, opts.fmtCompact(v), {
      fill: C.muted, "text-anchor": "end", "font-size": 12,
      style: "font-variant-numeric: tabular-nums",
    }));
  }

  // x ticks every 5 or 10 years of age
  const xStep = x1 - x0 > 45 ? 10 : 5;
  for (let a = Math.ceil(x0 / xStep) * xStep; a <= x1; a += xStep) {
    svg.append(text(X(a), m.top + plotH + 20, String(a), {
      fill: C.muted, "text-anchor": "middle", "font-size": 12,
      style: "font-variant-numeric: tabular-nums",
    }));
  }
  svg.append(text(m.left + plotW / 2, m.top + plotH + 38, "Age", {
    fill: C.muted, "text-anchor": "middle", "font-size": 12,
  }));

  // retirement marker (annotation, solid hairline)
  const retAge = opts.retirementAge;
  if (retAge > x0 && retAge < x1) {
    const rx = X(retAge);
    svg.append(el("line", {
      x1: rx, x2: rx, y1: m.top - 4, y2: m.top + plotH,
      stroke: C.baseline, "stroke-width": 1,
    }));
    // keep the annotation clear of the end labels: put it on the roomier side
    const rightHalf = rx > m.left + plotW / 2;
    svg.append(text(rx + (rightHalf ? -5 : 5), m.top + 6, `retire · ${retAge}`, {
      fill: C.muted, "font-size": 11, "text-anchor": rightHalf ? "end" : "start",
    }));
  }

  // area wash under the nominal line (~10% opacity)
  const linePath = (key) =>
    rows.map((row, i) => `${i ? "L" : "M"}${X(row.age).toFixed(1)},${Y(row[key]).toFixed(1)}`).join("");
  svg.append(el("path", {
    d: `${linePath("nominal")}L${X(x1).toFixed(1)},${Y(Math.max(yMin, 0)).toFixed(1)}L${X(x0).toFixed(1)},${Y(Math.max(yMin, 0)).toFixed(1)}Z`,
    fill: C.nominal, "fill-opacity": 0.1,
  }));

  // series lines, 2px round
  for (const key of ["real", "nominal"]) {
    svg.append(el("path", {
      d: linePath(key),
      fill: "none", stroke: C[key], "stroke-width": 2,
      "stroke-linejoin": "round", "stroke-linecap": "round",
    }));
  }

  // crosshair (hidden until hover/focus)
  const crosshair = el("line", {
    y1: m.top, y2: m.top + plotH,
    stroke: C.baseline, "stroke-width": 1, visibility: "hidden",
  });
  svg.append(crosshair);
  const hoverDots = ["nominal", "real"].map((key) => {
    const dot = el("circle", {
      r: 4.5, fill: C[key], stroke: C.surface, "stroke-width": 2, visibility: "hidden",
    });
    svg.append(dot);
    return { key, dot };
  });

  // end dots with 2px surface ring + direct end labels (relief for the
  // sub-3:1 aqua: values are visible without hover)
  const last = rows[rows.length - 1];
  for (const { key, dy } of [{ key: "nominal", dy: -10 }, { key: "real", dy: 18 }]) {
    svg.append(el("circle", {
      cx: X(last.age), cy: Y(last[key]), r: 4.5,
      fill: C[key], stroke: C.surface, "stroke-width": 2,
    }));
    svg.append(text(X(last.age) - 8, Y(last[key]) + dy, opts.fmtCompact(last[key]), {
      fill: C.ink, "text-anchor": "end", "font-size": 12, "font-weight": 600,
    }));
  }

  // tooltip
  const tooltip = document.createElement("div");
  tooltip.className = "chart-tooltip";
  tooltip.hidden = true;
  const ttTitle = document.createElement("p");
  ttTitle.className = "tt-title";
  tooltip.append(ttTitle);
  const ttRows = [
    { key: "nominal", name: "Net worth" },
    { key: "real", name: "Today's money" },
  ].map(({ key, name }) => {
    const row = document.createElement("div");
    row.className = "tt-row";
    const swatch = document.createElement("span");
    swatch.className = "tt-key";
    swatch.style.borderTopColor = C[key];
    const value = document.createElement("span");
    value.className = "tt-value";
    const label = document.createElement("span");
    label.className = "tt-name";
    label.textContent = name;
    row.append(swatch, value, label);
    tooltip.append(row);
    return { key, value };
  });

  let activeIndex = -1;
  function showIndex(i) {
    activeIndex = Math.max(0, Math.min(rows.length - 1, i));
    const row = rows[activeIndex];
    const px = X(row.age);
    crosshair.setAttribute("x1", px);
    crosshair.setAttribute("x2", px);
    crosshair.setAttribute("visibility", "visible");
    for (const { key, dot } of hoverDots) {
      dot.setAttribute("cx", px);
      dot.setAttribute("cy", Y(row[key]));
      dot.setAttribute("visibility", "visible");
    }
    ttTitle.textContent = `Age ${row.age} · ${row.year}`;
    for (const { key, value } of ttRows) value.textContent = opts.fmtFull(row[key]);
    tooltip.hidden = false;
    const flip = px > m.left + plotW * 0.62;
    tooltip.style.left = flip ? `${px - tooltip.offsetWidth - 14}px` : `${px + 14}px`;
    tooltip.style.top = `${Math.min(Y(row.nominal), m.top + plotH - 80)}px`;
  }
  function hide() {
    activeIndex = -1;
    crosshair.setAttribute("visibility", "hidden");
    for (const { dot } of hoverDots) dot.setAttribute("visibility", "hidden");
    tooltip.hidden = true;
  }

  const onMove = (ev) => {
    const rect = svg.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * width;
    const age = x0 + ((px - m.left) / plotW) * (x1 - x0);
    showIndex(Math.round(age - x0));
  };
  const onKey = (ev) => {
    if (ev.key === "ArrowRight") showIndex(activeIndex < 0 ? 0 : activeIndex + 1);
    else if (ev.key === "ArrowLeft") showIndex(activeIndex < 0 ? rows.length - 1 : activeIndex - 1);
    else if (ev.key === "Escape") hide();
    else return;
    ev.preventDefault();
  };
  const onFocus = () => { if (activeIndex < 0) showIndex(rows.length - 1); };

  container.addEventListener("pointermove", onMove);
  container.addEventListener("pointerleave", hide);
  container.addEventListener("keydown", onKey);
  container.addEventListener("focus", onFocus);
  container.addEventListener("blur", hide);

  container.append(svg, tooltip);
  return () => {
    container.removeEventListener("pointermove", onMove);
    container.removeEventListener("pointerleave", hide);
    container.removeEventListener("keydown", onKey);
    container.removeEventListener("focus", onFocus);
    container.removeEventListener("blur", hide);
  };
}

function niceStep(rough) {
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(rough, 1e-9))));
  for (const mult of [1, 2, 2.5, 5, 10]) {
    if (mult * mag >= rough) return mult * mag;
  }
  return 10 * mag;
}

function el(tag, attrs) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function text(x, y, content, attrs) {
  const node = el("text", { x, y, ...attrs });
  node.textContent = content;
  return node;
}
