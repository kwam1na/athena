import { C, addBg, card, label, metric, screenshot, sub, title } from "./theme.mjs";

export async function slide03(presentation, ctx) {
  const slide = presentation.slides.add();
  addBg(slide, ctx, "#FFFFFF");
  label(slide, ctx, "DAILY COMMAND");
  title(slide, ctx, "Start the day knowing what needs attention.", 54, 82, 510, 118);
  sub(slide, ctx, "Daily Operations combines sales, cash, carry-forward work, approvals, registers, POS sessions, expenses, and the store-day timeline.", 58, 218, 520, 84);
  await screenshot(slide, ctx, "01-daily-operations-clean.png", 646, 76, 572, 410);
  metric(slide, ctx, "7", "workflow checks", 72, 368, C.green);
  metric(slide, ctx, "1", "opening item", 260, 368, C.gold);
  metric(slide, ctx, "0", "open exceptions", 448, 368, C.blue);
  card(slide, ctx, 74, 522, 520, 76, "#F4F7F2", "#D8E5D7");
  ctx.addText(slide, { text: "Pitch line: Athena is the morning standup, the mid-day signal, and the end-of-day proof.", x: 96, y: 544, w: 480, h: 34, fontSize: 18, bold: true, color: C.ink });
  return slide;
}
