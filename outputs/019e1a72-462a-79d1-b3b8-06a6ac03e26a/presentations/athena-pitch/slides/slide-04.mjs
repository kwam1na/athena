import { C, addBg, label, metric, screenshot, sub, title } from "./theme.mjs";

export async function slide04(presentation, ctx) {
  const slide = presentation.slides.add();
  addBg(slide, ctx);
  label(slide, ctx, "SELL");
  title(slide, ctx, "One sales layer for walk-ins and online orders.", 54, 76, 540, 120);
  sub(slide, ctx, "The owner can move from checkout to completed orders without losing register, payment, delivery, or customer context.", 58, 332, 510, 74);
  await screenshot(slide, ctx, "02-point-of-sale-clean.png", 664, 64, 520, 270);
  await screenshot(slide, ctx, "07-orders-clean.png", 664, 374, 520, 260);
  metric(slide, ctx, "46", "completed orders visible", 70, 520, C.blue);
  metric(slide, ctx, "GH₵433", "net revenue in demo data", 258, 520, C.green);
  metric(slide, ctx, "POS", "in-store checkout hub", 446, 520, C.gold);
  return slide;
}
