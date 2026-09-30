"use client";

import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";

export function IconBadge({
  icon: Icon,
  size = 44,
  tone = "ink",
  className = "",
}: {
  icon: LucideIcon;
  size?: number;
  tone?: "ink" | "light";
  className?: string;
}) {
  const bg = tone === "ink" ? "bg-ink" : "bg-paper";
  const border = tone === "ink" ? "border-ink" : "border-ink/20";
  const stroke = tone === "ink" ? "#ec3013" : "#201e1d";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className={`flex shrink-0 items-center justify-center border-2 ${border} ${bg} ${className}`}
      style={{ width: size, height: size }}
    >
      <Icon size={size * 0.5} strokeWidth={2} color={stroke} />
    </motion.div>
  );
}
