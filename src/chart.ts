import { formatPt } from "./format";
import { seasonLabel, type Point } from "./metrics";

const COLORS = ["#f0c14a", "#ff6a3d", "#8fd3c8", "#d7a4ff", "#f3ead7", "#8ec7ff"];

export function mountChart(host: HTMLElement, segments: { season: number; points: Point[] }[]): void {
  host.replaceChildren();
  const points = segments.flatMap((segment) => segment.points);
  if (!points.length) {
    const empty = document.createElement("p");
    empty.textContent = "No stored ratings for this player in the selected seasons.";
    host.append(empty);
    return;
  }

  const width = 640;
  const height = 240;
  const pad = { l: 48, r: 16, t: 16, b: 28 };
  const ratings = points.map((point) => point.rating);
  let min = Math.min(...ratings);
  let max = Math.max(...ratings);
  if (min === max) {
    min -= 10;
    max += 10;
  } else {
    const slack = (max - min) * 0.08;
    min -= slack;
    max += slack;
  }
  const times = points.map((point) => Date.parse(point.t));
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const xFor = (iso: string) => {
    const span = Math.max(1, t1 - t0);
    return pad.l + ((Date.parse(iso) - t0) / span) * (width - pad.l - pad.r);
  };
  const yFor = (rating: number) => pad.t + ((max - rating) / (max - min)) * (height - pad.t - pad.b);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "group");
  const first = points[0];
  const last = points[points.length - 1];
  svg.setAttribute(
    "aria-label",
    `${points.length} stored ratings from ${first.rating} to ${last.rating}, split by season.`,
  );

  for (const tick of [min, (min + max) / 2, max]) {
    const y = yFor(tick);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(pad.l));
    line.setAttribute("x2", String(width - pad.r));
    line.setAttribute("y1", String(y));
    line.setAttribute("y2", String(y));
    line.setAttribute("class", "grid");
    svg.append(line);
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", "4");
    label.setAttribute("y", String(y + 4));
    label.setAttribute("class", "tick");
    label.textContent = String(Math.round(tick));
    svg.append(label);
  }

  segments.forEach((segment, index) => {
    const color = COLORS[segment.season % COLORS.length];
    if (segment.points.length >= 2) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-width", "2.5");
      path.setAttribute("points", segment.points.map((point) => `${xFor(point.t)},${yFor(point.rating)}`).join(" "));
      svg.append(path);
    }
    for (const point of segment.points) {
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("cx", String(xFor(point.t)));
      dot.setAttribute("cy", String(yFor(point.rating)));
      dot.setAttribute("r", "4");
      dot.setAttribute("fill", color);
      const mark = point.mark === "unverified" ? " · unverified" : point.mark === "final" ? " · official final" : "";
      const tipText = `${seasonLabel(segment.season)} · ${formatPt(point.t)} · rating ${point.rating} · rank ${point.rank}${mark}`;
      dot.dataset.tip = tipText;
      dot.setAttribute("role", "img");
      dot.setAttribute("aria-label", tipText);
      if (point.mark === "unverified") dot.setAttribute("stroke", "#c4554a");
      if (point.mark === "final") dot.setAttribute("stroke", "#f0c14a");
      svg.append(dot);
    }
    if (index > 0 && segment.points[0]) {
      const marker = document.createElementNS("http://www.w3.org/2000/svg", "line");
      const x = String(xFor(segment.points[0].t));
      marker.setAttribute("x1", x);
      marker.setAttribute("x2", x);
      marker.setAttribute("y1", String(pad.t));
      marker.setAttribute("y2", String(height - pad.b));
      marker.setAttribute("class", "split");
      svg.append(marker);
    }
  });

  const tip = document.createElement("p");
  tip.className = "chart-tip";
  tip.setAttribute("aria-live", "polite");
  tip.textContent = "Hover or focus a point.";

  const pointList = document.createElement("ul");
  pointList.className = "sr-only";
  for (const circle of svg.querySelectorAll("circle")) {
    const item = document.createElement("li");
    item.textContent = circle.getAttribute("aria-label") || "";
    pointList.append(item);
  }

  const show = (text: string) => {
    tip.textContent = text;
  };
  svg.addEventListener("pointermove", (event) => {
    const target = event.target;
    if (target instanceof SVGCircleElement && target.dataset.tip) show(target.dataset.tip);
  });
  svg.addEventListener("focusin", (event) => {
    const target = event.target;
    if (target instanceof SVGCircleElement && target.dataset.tip) show(target.dataset.tip);
  });
  for (const circle of svg.querySelectorAll("circle")) {
    circle.setAttribute("tabindex", "0");
  }

  const axis = document.createElement("p");
  axis.className = "axis";
  axis.textContent = `${formatPt(first.t)} to ${formatPt(last.t)}`;

  host.append(svg, pointList, tip, axis);
}
