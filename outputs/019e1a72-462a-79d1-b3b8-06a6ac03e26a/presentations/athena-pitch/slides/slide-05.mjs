import { C, addBg, card, label, metric, screenshot, sub, title } from "./theme.mjs";

export async function slide05(presentation, ctx) {
  const slide = presentation.slides.add();
  addBg(slide, ctx, "#FFFFFF");
  label(slide, ctx, "CONTROL");
  title(slide, ctx, "Cash and stock stop living in memory.", 54, 78, 520, 120);
  sub(slide, ctx, "Athena binds the physical shop back to operational evidence: drawer sessions, deposits, variances, low-stock pressure, purchase drafts, and receiving.", 58, 214, 500, 92);
  await screenshot(slide, ctx, "04-cash-controls-clean.png", 626, 62, 548, 250);
  await screenshot(slide, ctx, "03-procurement-clean.png", 626, 350, 548, 260);
  metric(slide, ctx, "137", "SKUs needing action", 70, 378, C.gold);
  metric(slide, ctx, "GH₵0", "variance to review", 258, 378, C.green);
  card(slide, ctx, 70, 512, 500, 74, "#F6F3EC", C.line);
  ctx.addText(slide, { text: "The owner sees what to order, what to deposit, and what to close before the day drifts.", x: 94, y: 536, w: 448, h: 28, fontSize: 18, bold: true, color: C.ink });
  return slide;
}
