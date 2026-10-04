import { CUSTOM_STATUS_LINE_DEFAULTS } from "./schema";
import type { PresetDef, StatusLinePreset } from "./types";

export const STATUS_LINE_PRESETS: Record<StatusLinePreset, PresetDef> = {
	default: {
		leftSegments: ["pi", "vim", "model", "mode", "collab", "stream", "path", "git", "pr", "context_pct", "cost"],
		rightSegments: ["session_name"],
		separator: "powerline-thin",
		segmentOptions: {
			model: { showThinkingLevel: true },
			path: { abbreviate: true, maxLength: 40, stripWorkPrefix: true },
			git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: true },
		},
	},

	minimal: {
		leftSegments: ["vim", "path", "git"],
		rightSegments: ["session_name", "mode", "context_pct"],
		separator: "slash",
		segmentOptions: {
			path: { abbreviate: true, maxLength: 30 },
			git: { showBranch: true, showStaged: false, showUnstaged: false, showUntracked: false },
		},
	},

	compact: {
		leftSegments: ["vim", "model", "mode", "git", "pr"],
		rightSegments: ["session_name", "cost", "context_pct"],
		separator: "powerline-thin",
		segmentOptions: {
			model: { showThinkingLevel: false },
			git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: false },
		},
	},

	full: {
		leftSegments: ["pi", "vim", "hostname", "model", "mode", "path", "git", "pr", "subagents"],
		rightSegments: [
			"session_name",
			"cache_hit",
			"token_in",
			"token_out",
			"token_rate",
			"cache_read",
			"cost",
			"context_pct",
			"time_spent",
			"time",
		],
		separator: "powerline",
		segmentOptions: {
			model: { showThinkingLevel: true },
			path: { abbreviate: true, maxLength: 50 },
			git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: true },
			time: { format: "24h", showSeconds: false },
		},
	},

	nerd: {
		// Full preset with all Nerd Font icons
		leftSegments: ["pi", "vim", "hostname", "model", "mode", "path", "git", "pr", "session", "subagents"],
		rightSegments: [
			"session_name",
			"token_in",
			"token_out",
			"cache_read",
			"cache_write",
			"token_rate",
			"cost",
			"context_pct",
			"context_total",
			"time_spent",
			"time",
		],
		separator: "powerline",
		segmentOptions: {
			model: { showThinkingLevel: true },
			path: { abbreviate: true, maxLength: 60 },
			git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: true },
			time: { format: "24h", showSeconds: true },
		},
	},

	ascii: {
		// No Nerd Font dependencies
		leftSegments: ["vim", "model", "mode", "path", "git", "pr"],
		rightSegments: ["session_name", "token_total", "cost", "context_pct"],
		separator: "ascii",
		segmentOptions: {
			model: { showThinkingLevel: true },
			path: { abbreviate: true, maxLength: 40 },
			git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: true },
		},
	},

	custom: {
		// User-defined - these are just defaults that get overridden
		leftSegments: [...CUSTOM_STATUS_LINE_DEFAULTS.left],
		rightSegments: [...CUSTOM_STATUS_LINE_DEFAULTS.right],
		separator: "powerline-thin",
		segmentOptions: {},
	},
};

/**
 * Segments every built-in preset places on the right-hand end of the bar.
 *
 * The bar is one line, not two, so the editor exposes it as one list; this is
 * how that list decides which end a segment belongs to. Derived from the presets
 * rather than hand-written, so a new preset that keeps the same convention moves
 * the boundary with it. Segments a preset puts on either side — `mode`,
 * `context_pct`, `cost` — are not in here and take the left.
 */
export const END_OF_BAR_SEGMENTS: ReadonlySet<string> = (() => {
	const left = new Set<string>();
	const right = new Set<string>();
	for (const preset of Object.values(STATUS_LINE_PRESETS)) {
		for (const segment of preset.leftSegments) left.add(segment);
		for (const segment of preset.rightSegments) right.add(segment);
	}
	return new Set([...right].filter(segment => !left.has(segment)));
})();

export function getPreset(name: StatusLinePreset): PresetDef {
	return STATUS_LINE_PRESETS[name] ?? STATUS_LINE_PRESETS.default;
}
