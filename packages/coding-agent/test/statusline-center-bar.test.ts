import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { Settings } from "../src/config/settings";
import { createSettingsHost } from "../src/config/settings-ui";
import { SelectorController } from "../src/modes/controllers/selector-controller";
import { statusLineHost } from "../src/modes/status-line-host";
import {
	cfgGitEnabled,
	cfgStatusLineLeftSegments,
	cfgStatusLinePreset,
	cfgStatusLineRightSegments,
} from "../src/modes/settings";
import type { InteractiveModeContext } from "../src/modes/types";
import { StatusLineComponent } from "@oh-my-pi/pi-tui/status-line";
import { STATUS_LINE_PRESETS } from "@oh-my-pi/pi-tui/status-line/presets";
import { centerBarSegments } from "@oh-my-pi/pi-tui/overlays/settings-selector";
import { initTheme } from "@oh-my-pi/pi-tui/theme";
import { removeSyncWithRetries, setProjectDir } from "@oh-my-pi/pi-utils";
import { beginSettingsTest, restoreSettingsTestState, type SettingsTestState } from "./helpers/settings-test-state";
import { StatusLineTestComponents } from "./helpers/status-line";

/**
 * `statusLine.segments` carries the old `custom` baseline as its schema default,
 * so "no merged list" was never a state the bar could see: it always re-split a
 * list nobody had configured. These tests drive the real settings store, the real
 * host and the real renderer, because a hand-built `StatusLineSettings` literal
 * can spell `segments: undefined` and the host never could.
 */

let settingsState: SettingsTestState | undefined;
let projectDir = "";
const statusLines = new StatusLineTestComponents();

beforeEach(async () => {
	settingsState = beginSettingsTest();
	projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-statusline-center-bar-"));
	setProjectDir(projectDir);
	await Settings.init({ inMemory: true, cwd: projectDir });
	await initTheme();
	// Nothing in this file is about git; keep the bar off the filesystem.
	cfgGitEnabled.override(Settings.instance, false);
});

afterEach(() => {
	statusLines.dispose();
	restoreSettingsTestState(settingsState);
	settingsState = undefined;
	if (projectDir) removeSyncWithRetries(projectDir);
	projectDir = "";
});

function makeSession() {
	const messages: unknown[] = [];
	const model = {
		id: "sonnet-5",
		name: "Sonnet 5",
		contextWindow: 200_000,
		thinking: true,
	};
	return {
		state: { messages, model, thinkingLevel: "high" },
		messages,
		model,
		systemPrompt: [],
		agent: { state: { tools: [] } },
		skills: [],
		isStreaming: false,
		isAutoThinking: false,
		autoResolvedThinkingLevel: () => undefined,
		isFastModeActive: () => false,
		isAdvisorActive: () => false,
		getAdvisorStatusOverview: () => ({ configured: false, advisors: [] }),
		getAsyncJobSnapshot: () => ({ running: [] }),
		settings: { get: () => false },
		modelRegistry: { isUsingOAuth: () => false },
		sessionManager: {
			getSessionId: () => "9f3a1c77-session",
			getSessionName: () => "legacy-session",
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
				cost: 4.56,
			}),
		},
		getContextUsage: () => ({ tokens: 50_000, contextWindow: 200_000, percent: 25 }),
	} as unknown as ConstructorParameters<typeof StatusLineComponent>[0];
}

/** The live bar, fed the way `#syncStatusLineSettings` feeds it: straight from the real host. */
function renderBar(): { content: string; left: readonly string[]; right: readonly string[] } {
	const component = statusLines.track(new StatusLineComponent(makeSession(), statusLineHost));
	component.updateSettings(statusLineHost.getSettings());
	const effective = component.getEffectiveSettingsForTest();
	return {
		content: stripVTControlCharacters(component.getTopBorder(200).content).trim(),
		left: effective.leftSegments,
		right: effective.rightSegments,
	};
}

/** The controller only reaches for `settings`, `statusLine` and `ui` on this path. */
function createController(): SelectorController {
	const ctx = {
		settings: Settings.instance,
		statusLine: { invalidate: vi.fn() },
		ui: { invalidate: vi.fn(), requestRender: vi.fn() },
	} as unknown as InteractiveModeContext;
	return new SelectorController(ctx);
}

describe("status line center bar", () => {
	// The compatibility promise #14303 made in its own body: a config that sets
	// the two halves keeps working. It did not, because the merged list was never
	// absent and always won.
	it("keeps the configured right half of a legacy halves config", () => {
		cfgStatusLinePreset.set(Settings.instance, "custom");
		cfgStatusLineLeftSegments.set(Settings.instance, ["model"]);
		cfgStatusLineRightSegments.set(Settings.instance, ["session_name", "session"]);

		const bar = renderBar();

		expect(bar.left).toEqual(["model"]);
		expect(bar.right).toEqual(["session_name", "session"]);
		expect(bar.content).toContain("Sonnet 5");
		expect(bar.content).toContain("legacy-session");
		expect(bar.content).toContain("9f3a1c77");
	});

	// The Center Bar row is the only segment editor, and it writes the merged
	// list. Its first edit used to switch the bar to a list of six default
	// segments, dropping five of the twelve on screen.
	it("does not lose segments when the Center Bar row is first edited", () => {
		const before = renderBar();
		const row = centerBarSegments(createSettingsHost());
		expect(row).toEqual([...STATUS_LINE_PRESETS.default.leftSegments, ...STATUS_LINE_PRESETS.default.rightSegments]);

		// One segment ticked in the row, then the row's own change handler.
		const edited = [...row, "subagents"];
		createSettingsHost().set("statusLine.segments", edited);
		createController().handleSettingChange("statusLine.segments", edited);

		const after = renderBar();
		expect(after.left).toEqual(expect.arrayContaining(before.left));
		expect(after.right).toEqual(expect.arrayContaining(before.right));
		expect(after.content).toContain("legacy-session");
		expect(after.content).toContain("25%");
		expect(after.content).toContain("$4.56");
		expect(after.content).toContain("Sonnet 5");
	});
});
