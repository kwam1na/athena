import { C, addBg, label, metric, screenshot, sub, title } from "./theme.mjs";

export async function slide07(presentation, ctx) {
  const slide = presentation.slides.add();
  addBg(slide, ctx, "#FFFFFF");
  label(slide, ctx, "LEARN");
  title(slide, ctx, "Storefront behavior becomes an operating signal.", 54, 78, 520, 126);
  sub(slide, ctx, "Athena shows who is moving, which products are drawing attention, and where checkout needs follow-up.", 58, 330, 500, 70);
  await screenshot(slide, ctx, "05-analytics-clean.png", 618, 74, 560, 430);
  metric(slide, ctx, "55", "known shoppers", 78, 470, C.green);
  metric(slide, ctx, "87", "product views", 266, 470, C.blue);
  metric(slide, ctx, "2", "visitors today", 454, 470, C.gold);
  ctx.addText(slide, { text: "The next best action starts with real behavior.", x: 86, y: 620, w: 500, h: 34, fontSize: 26, bold: true, color: C.ink });
  return slide;
}
