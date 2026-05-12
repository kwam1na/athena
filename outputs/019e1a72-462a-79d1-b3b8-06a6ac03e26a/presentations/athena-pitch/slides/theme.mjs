export const C = {
  ink: "#101827",
  muted: "#5B6472",
  pale: "#F6F3EC",
  line: "#D9D4C8",
  green: "#2E7D5B",
  blue: "#375D9D",
  red: "#B84A41",
  gold: "#B9832E",
  white: "#FFFFFF",
  black: "#0B0F14",
};

export function addBg(slide, ctx, fill = C.pale) {
  ctx.addShape(slide, { x: 0, y: 0, w: ctx.W, h: ctx.H, fill });
}

export function label(slide, ctx, text, x = 54, y = 42, color = C.green) {
  ctx.addText(slide, {
    text,
    x,
    y,
    w: 360,
    h: 26,
    fontSize: 14,
    bold: true,
    color,
    typeface: ctx.fonts.body,
  });
}

export function title(slide, ctx, text, x = 54, y = 82, w = 650, h = 118, color = C.ink) {
  ctx.addText(slide, {
    text,
    x,
    y,
    w,
    h,
    fontSize: 48,
    bold: true,
    color,
    typeface: ctx.fonts.title,
    insets: { left: 0, right: 0, top: 0, bottom: 0 },
  });
}

export function sub(slide, ctx, text, x = 58, y = 214, w = 540, h = 72, color = C.muted) {
  ctx.addText(slide, {
    text,
    x,
    y,
    w,
    h,
    fontSize: 20,
    color,
    typeface: ctx.fonts.body,
    insets: { left: 0, right: 0, top: 0, bottom: 0 },
  });
}

export function foot(slide, ctx, text) {
  ctx.addText(slide, {
    text,
    x: 54,
    y: 684,
    w: 760,
    h: 22,
    fontSize: 11,
    color: "#7B817E",
    typeface: ctx.fonts.body,
  });
}

export function card(slide, ctx, x, y, w, h, fill = C.white, line = C.line) {
  return ctx.addShape(slide, {
    x,
    y,
    w,
    h,
    fill,
    line: ctx.line(line, 1),
  });
}

export function metric(slide, ctx, value, labelText, x, y, accent = C.green) {
  card(slide, ctx, x, y, 168, 84, C.white, C.line);
  ctx.addText(slide, {
    text: value,
    x: x + 16,
    y: y + 16,
    w: 136,
    h: 34,
    fontSize: 28,
    bold: true,
    color: accent,
    typeface: ctx.fonts.title,
  });
  ctx.addText(slide, {
    text: labelText,
    x: x + 16,
    y: y + 52,
    w: 136,
    h: 20,
    fontSize: 12,
    color: C.muted,
    typeface: ctx.fonts.body,
  });
}

export function pill(slide, ctx, text, x, y, w, fill, color = C.ink) {
  card(slide, ctx, x, y, w, 38, fill, "transparent");
  ctx.addText(slide, {
    text,
    x: x + 12,
    y: y + 10,
    w: w - 24,
    h: 18,
    fontSize: 13,
    bold: true,
    color,
    typeface: ctx.fonts.body,
    align: "center",
  });
}

export async function screenshot(slide, ctx, file, x, y, w, h, fit = "cover") {
  return ctx.addImage(slide, {
    path: `${ctx.workspaceDir}/assets/${file}`,
    x,
    y,
    w,
    h,
    fit,
    alt: file,
  });
}
