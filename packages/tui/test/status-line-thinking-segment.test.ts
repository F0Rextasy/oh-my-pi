import { beforeAll, describe, expect, it } from "bun:test";
import { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import type { SegmentContext } from "../src/status-line/segments";
import { renderSegment } from "../src/status-line/segments";
import type { StatusLineSegmentOptions } from "../src/status-line/types";
import { initTheme } from "../src/theme";

beforeAll(async () => {
	await initTheme();
});

/**
 * The `thinking` segment reads the model segment's `showThinkingLevel` option,
 * so the Model row's thinking switch blanked this segment too, and putting both
 * on the bar printed the same level twice. The segment has its own namespace now.
 */
function thinkingContext(options: StatusLineSegmentOptions): SegmentContext {
	return {
		session: {
			state: {
				model: { id: "test-model", name: "Sonnet 5", thinking: true },
				thinkingLevel: ThinkingLevel.High,
			},
			isFastModeActive: () => false,
			isAutoThinking: false,
			autoResolvedThinkingLevel: () => undefined,
			isAdvisorActive: () => false,
		} as unknown as SegmentContext["session"],
		width: 120,
		compactThinkingLevel: false,
		options,
		planMode: null,
		loopMode: null,
		prewalk: null,
		goalMode: null,
		vibeMode: null,
		vim: null,
		collab: null,
		stream: null,
		recording: false,
		usageStats: {
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
			tokensPerSecond: null,
		},
		contextPercent: 0,
		contextTokens: 0,
		contextWindow: 0,
		autoCompactEnabled: false,
		compactionSpeculation: "idle",
		speculationBlinkOn: true,
		subagentCount: 0,
		activeMs: 0,
		turnElapsedMs: null,
		activeRepo: null,
		worktree: null,
		git: { branch: null, status: null, pr: null },
		usage: null,
	};
}

describe("status line thinking segment", () => {
	it("ignores the model segment's thinking option", () => {
		const rendered = renderSegment("thinking", thinkingContext({ model: { showThinkingLevel: false } }));

		expect(rendered.visible).toBe(true);
		expect(rendered.content).toContain("high");
	});

	it("ignores an unset thinking option", () => {
		const rendered = renderSegment("thinking", thinkingContext({}));

		expect(rendered.visible).toBe(true);
		expect(rendered.content).toContain("high");
	});

	it("honours its own option", () => {
		const rendered = renderSegment("thinking", thinkingContext({ thinking: { show: false } }));

		expect(rendered).toEqual({ content: "", visible: false });
	});

	// The model segment keeps its own switch: turning the level off there must
	// not change what the thinking segment draws.
	it("renders the same thing whatever the model segment is set to", () => {
		const withLevel = renderSegment("thinking", thinkingContext({ model: { showThinkingLevel: true } }));
		const withoutLevel = renderSegment("thinking", thinkingContext({ model: { showThinkingLevel: false } }));

		expect(withoutLevel).toEqual(withLevel);
	});
});
