import { beforeAll, describe, expect, it } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import type { Model } from "@oh-my-pi/pi-catalog/types";
import { StatusLineComponent } from "../src/status-line/component";
import type { StatusLineHost, StatusLineSession } from "../src/status-line/host";
import { STATUS_LINE_PRESETS } from "../src/status-line/presets";
import type { StatusLineSegmentId, StatusLineSettings } from "../src/status-line/types";
import { initTheme } from "../src/theme";

beforeAll(async () => {
	await initTheme();
});

const MODEL = getBundledModel("deepseek", "deepseek-v4-flash");
const CONTEXT_WINDOW = 200_000;

interface HarnessOptions {
	settings: StatusLineSettings;
	/** Tokens used; percent is derived so the gauge's `pct` matches the width. */
	tokens: number;
}

function harness(options: HarnessOptions): StatusLineComponent {
	const model: Model = { ...MODEL, contextWindow: CONTEXT_WINDOW };
	const session = {
		state: { model, messages: [] },
		model,
		messages: [],
		isStreaming: false,
		isAutoThinking: false,
		sessionManager: {
			getSessionName: () => undefined,
			getSessionId: () => "sess",
			getUsageStatistics: () => ({
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				orchestrationInput: 0,
				orchestrationOutput: 0,
				orchestrationCacheRead: 0,
				premiumRequests: 0,
				cost: 0,
			}),
		},
		modelRegistry: { isUsingOAuth: () => false },
		getContextUsage: () => ({
			tokens: options.tokens,
			contextWindow: CONTEXT_WINDOW,
			percent: (options.tokens / CONTEXT_WINDOW) * 100,
		}),
		autoResolvedThinkingLevel: () => undefined,
		isFastModeActive: () => false,
		getAsyncJobSnapshot: () => null,
		getGoalModeState: () => undefined,
	} as unknown as StatusLineSession;
	const host: StatusLineHost = {
		getSettings: () => options.settings,
		gitEnabled: () => false,
		codexResetFireworksEnabled: () => false,
		getSettingsRevision: () => 0,
		getSessionSettingsIdentity: () => undefined,
		getSessionSettingsRevision: () => 0,
		goalStatusInFooter: () => false,
		activeAccount: () => undefined,
		canFetchUsageReports: () => false,
		fetchUsageReports: async () => null,
		resolveActiveRepo: () => null,
		lookupPullRequest: async () => ({ stdout: "", exitCode: 1 }),
		calculateTokensPerSecond: () => null,
		limitMatchesActiveAccount: () => false,
		computeCompactionBoundaries: () => null,
	};
	return new StatusLineComponent(session, host);
}

/** Render the box composer's top border (where the embedded gauge lives) as plain text. */
function renderGauge(leftSegments: StatusLineSegmentId[], tokens: number, width = 200): string {
	const line = harness({
		settings: {
			preset: "custom",
			leftSegments,
			rightSegments: ["session_name"],
			contextLine: "embedded",
		},
		tokens,
	});
	return stripVTControlCharacters(line.getTopBorder(width).content);
}

describe("embedded context gauge labels", () => {
	// The embedded gauge absorbed both context segments regardless of which
	// one was configured, so `context_pct` alone printed a window number the
	// user never asked for and `context_total` alone printed a percentage.
	it("prints only the percentage when context_pct is the configured segment", () => {
		const bar = renderGauge(["model", "context_pct"], 62_000);
		expect(bar).toContain("31%");
		expect(bar).not.toContain("200K");
	});

	it("prints only the window when context_total is the configured segment", () => {
		const bar = renderGauge(["model", "context_total"], 62_000);
		expect(bar).toContain("200K");
		expect(bar).not.toContain("31%");
	});

	it("prints no label when the configured context segments have no visible width", () => {
		// A gauge with neither id configured keeps the bare accent line.
		const bar = renderGauge(["model"], 62_000);
		expect(bar).not.toContain("200K");
		expect(bar).not.toContain("31%");
	});

	it("still prints both labels when both context segments are configured", () => {
		const bar = renderGauge(["model", "context_pct", "context_total"], 62_000);
		expect(bar).toContain("31%");
		expect(bar).toContain("200K");
	});

	it("stops the shipped default preset from printing a window number nobody configured", () => {
		// The default preset configures `context_pct` only. Before the fix the
		// embedded gauge drew the window label anyway, so an untouched install
		// showed `──31%──200K─`.
		const line = harness({
			settings: { preset: "default", contextLine: "embedded" },
			tokens: 62_000,
		});
		const bar = stripVTControlCharacters(line.getTopBorder(200).content);
		expect(STATUS_LINE_PRESETS.default.leftSegments).toContain("context_pct");
		expect(STATUS_LINE_PRESETS.default.leftSegments).not.toContain("context_total");
		expect(bar).toContain("31%");
		expect(bar).not.toContain("200K");
	});

	it("anchors an over-100% percentage at the right edge without a window label", () => {
		// >100% (model switch to a smaller window) draws the percent past the
		// window label. With no window label the percent is its own anchor, so
		// it must still end flush with the gap's right edge.
		const tokens = Math.round(CONTEXT_WINDOW * 1.2);
		const bar = renderGauge(["model", "context_pct"], tokens);
		expect(bar).toContain("120%");
		expect(bar).not.toContain("200K");
		expect(bar.endsWith("120%")).toBe(true);
	});

	it("leaves the annotated gauge alone: the ids still mean different things", () => {
		const annotated = (leftSegments: StatusLineSegmentId[]): string =>
			stripVTControlCharacters(
				harness({
					settings: { preset: "custom", leftSegments, rightSegments: [], contextLine: "annotated" },
					tokens: 62_000,
				}).getTopBorder(200).content,
			);
		expect(annotated(["model", "context_pct"])).toContain("31.0%/200K");
		expect(annotated(["model", "context_total"])).toContain("200K");
		expect(annotated(["model", "context_total"])).not.toContain("31.0%");
	});
});
