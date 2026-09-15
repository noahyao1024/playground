"use client";

import { MotionConfig } from "framer-motion";

/** Honour the operating system's "reduce motion" setting. Framer reads it itself
 *  once told to: transforms and fades are dropped for anyone who asked for that,
 *  without every animation in the app needing to check. */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
