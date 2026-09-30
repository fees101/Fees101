"use client";

import { motion } from "framer-motion";
import { Workflow, ListChecks, Zap } from "lucide-react";
import { Reveal } from "@/components/Reveal";

export function HeroVisual() {
  return (
    <Reveal delay={0.1} className="hidden justify-center md:flex">
      <div className="relative flex h-72 w-72 items-center justify-center">
        <motion.div
          className="absolute inset-0 rounded-full bg-mint-light/70"
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.7, rotate: -8 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <Workflow size={110} strokeWidth={1.4} className="text-mint-dark" />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.6, x: 10 }}
          animate={{ opacity: 1, scale: 1, x: 0, y: [0, -6, 0] }}
          transition={{
            opacity: { delay: 0.5, duration: 0.5 },
            scale: { delay: 0.5, duration: 0.5 },
            y: { delay: 1, duration: 3, repeat: Infinity, ease: "easeInOut" },
          }}
          className="absolute -right-2 top-6 flex items-center gap-2 rounded-xl border border-black/5 bg-white px-3 py-2 text-xs font-semibold text-navy shadow-lg"
        >
          <ListChecks size={15} className="text-mint-dark" />
          6 simple steps
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.6, x: -10 }}
          animate={{ opacity: 1, scale: 1, x: 0, y: [0, 6, 0] }}
          transition={{
            opacity: { delay: 0.7, duration: 0.5 },
            scale: { delay: 0.7, duration: 0.5 },
            y: { delay: 1.2, duration: 3.4, repeat: Infinity, ease: "easeInOut" },
          }}
          className="absolute -left-4 bottom-8 flex items-center gap-2 rounded-xl border border-black/5 bg-white px-3 py-2 text-xs font-semibold text-navy shadow-lg"
        >
          <Zap size={15} className="text-mint-dark" />
          Fully automated
        </motion.div>
      </div>
    </Reveal>
  );
}
