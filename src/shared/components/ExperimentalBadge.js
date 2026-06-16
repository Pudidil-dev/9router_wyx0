"use client";

import PropTypes from "prop-types";
import { cn } from "@/shared/utils/cn";

/**
 * ExperimentalBadge — small amber pill that flags features/providers as experimental.
 *
 * Two sizes:
 *   - "compact": "EXP" — for tight spots like card headers, list items, inline tags
 *   - "full":    "EXPERIMENTAL" — for detail/header areas where space allows
 *
 * Visual style matches the established convention used on the Profile page's
 * Proxy Scraper section: amber background tint with uppercase tracking.
 *
 * Usage:
 *   <ExperimentalBadge />                 // defaults to "full"
 *   <ExperimentalBadge size="compact" />  // "EXP"
 *   <ExperimentalBadge size="full" title="..." />
 *   <ExperimentalBadge label="Beta" />    // override label without changing styling
 */
export default function ExperimentalBadge({
  size = "full",
  label,
  title,
  className,
}) {
  const text = label ?? (size === "compact" ? "EXP" : "Experimental");
  const sizing =
    size === "compact"
      ? "px-1.5 py-0 text-[9px]"
      : "px-2 py-0.5 text-[10px]";

  return (
    <span
      className={cn(
        "rounded-full bg-amber-500/10 font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400 whitespace-nowrap",
        sizing,
        className
      )}
      title={title || "Experimental — may change or break without warning"}
    >
      {text}
    </span>
  );
}

ExperimentalBadge.propTypes = {
  size: PropTypes.oneOf(["compact", "full"]),
  label: PropTypes.string,
  title: PropTypes.string,
  className: PropTypes.string,
};
