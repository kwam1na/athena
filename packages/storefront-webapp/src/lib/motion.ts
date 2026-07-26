export const STANDARD_MOTION_EASE = [0.22, 1, 0.36, 1] as const;

export type RevealMotionOptions = {
  delay?: number;
  distance?: number;
  duration?: number;
};

export function getRevealMotion(
  reducedMotion: boolean,
  {
    delay = 0,
    distance = 8,
    duration = 0.24,
  }: RevealMotionOptions = {},
) {
  if (reducedMotion) {
    return {
      initial: { opacity: 1, y: 0 },
      animate: { opacity: 1, y: 0 },
      transition: { delay: 0, duration: 0 },
    };
  }

  return {
    initial: { opacity: 0, y: distance },
    animate: { opacity: 1, y: 0 },
    transition: {
      delay,
      duration,
      ease: STANDARD_MOTION_EASE,
    },
  };
}
