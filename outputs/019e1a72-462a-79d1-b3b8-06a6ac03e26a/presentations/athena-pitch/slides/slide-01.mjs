import { C, addBg, card, foot, label, screenshot, sub, title } from "./theme.mjs";

export async function slide01(presentation, ctx) {
  const slide = presentation.slides.add();
  addBg(slide, ctx, "#FBFAF7");
  await screenshot(slide, ctx, "01-daily-operations-clean.png", 650, 84, 560, 392);
  card(slide, ctx, 650, 84, 560, 392, "#00000000", "#CFC8BA");
  label(slide, ctx, "ATHENA", 58, 48, C.green);
  title(slide, ctx, "The business OS for the owner who runs everything.", 58, 108, 560, 156);
  sub(slide, ctx, "Sell in person. Sell online. Replenish stock. Control cash. Run services. Close the day with evidence instead of guesswork.", 62, 286, 500, 116);
  ctx.addText(slide, { text: "Built for solo retail and service operators", x: 62, y: 438, w: 420, h: 28, fontSize: 18, bold: true, color: C.ink });
  foot(slide, ctx, "Source: Athena live app and repo business OS audit.");
  return slide;
}
