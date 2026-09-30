"use client";

import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";

export function IconBadge({
  icon: Icon,
  size = 44,
  tone = "navy",
  className = "",
}: {
  icon: LucideIcon;
  size?: number;
  tone?: "navy" | "light";
  className?: string;
}) {
  const bg = tone === "navy" ? "bg-navy" : "bg-white/10";
  const stroke = tone === "navy" ? "#5ad8a6" : "#ffffff";

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.5, rotate: -12 }}
      whileInView={{ opacity: 1, scale: 1, rotate: 0 }}
      viewport={{ once: true }}
      whileHover={{ rotate: [0, -10, 8, 0], scale: 1.1 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className={`flex shrink-0 items-center justify-center rounded-xl ${bg} ${className}`}
      style={{ width: size, height: size }}
    >
      <Icon size={size * 0.5} strokeWidth={2} color={stroke} />
    </motion.div>
  );
}
