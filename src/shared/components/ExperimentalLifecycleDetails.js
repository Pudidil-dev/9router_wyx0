"use client";

import { useState } from "react";
import PropTypes from "prop-types";

/**
 * Collapsible "What to expect" panel for experimental providers.
 *
 * Renders below the short experimentalNotice. Closed by default — only the
 * curious user clicks to expand. This is layered disclosure: short warning
 * up top, full lifecycle expectations on demand.
 *
 * Pass `sections` as an array of { heading, body, items? } where:
 *   - heading: short title (e.g., "Cookie expiry")
 *   - body:    one-line explanation
 *   - items:   optional bullet list of specifics
 *
 * Or pass `children` for fully custom content.
 */
export default function ExperimentalLifecycleDetails({
  title = "What to expect",
  subtitle,
  sections,
  children,
  defaultOpen = false,
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-amber-500/5 rounded-lg transition-colors"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="material-symbols-outlined text-[16px] text-amber-500 shrink-0">help_outline</span>
          <span className="text-sm font-medium text-amber-700 dark:text-amber-300 truncate">{title}</span>
        </span>
        <span
          className={`material-symbols-outlined text-[18px] text-amber-500 shrink-0 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        >
          expand_more
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 space-y-3 text-xs text-text-muted leading-relaxed">
          {subtitle && <p>{subtitle}</p>}
          {sections?.map((section, i) => (
            <div key={i} className="space-y-1">
              {section.heading && (
                <p className="font-medium text-text-primary text-[13px]">{section.heading}</p>
              )}
              {section.body && <p>{section.body}</p>}
              {Array.isArray(section.items) && section.items.length > 0 && (
                <ul className="list-disc list-inside space-y-0.5 pl-1">
                  {section.items.map((item, j) => (
                    <li key={j}>{item}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          {children}
        </div>
      )}
    </div>
  );
}

ExperimentalLifecycleDetails.propTypes = {
  title: PropTypes.string,
  subtitle: PropTypes.string,
  sections: PropTypes.arrayOf(
    PropTypes.shape({
      heading: PropTypes.string,
      body: PropTypes.string,
      items: PropTypes.arrayOf(PropTypes.string),
    })
  ),
  children: PropTypes.node,
  defaultOpen: PropTypes.bool,
};
