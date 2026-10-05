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
	cfgStatusLineSegments,
} from "../src/modes/settings";
import type { InteractiveModeContext } from "../src/modes/types";
import { StatusLineComponent } from "@oh-my-pi/pi-tui/status-line";
import { END_OF_BAR_SEGMENTS, STATUS_LINE_PRESETS } from "@oh-my-pi/pi-tui/status-line/presets";
import { BUILTIN_MODE_SLASH_COMMANDS } from "../src/slash-commands/builtin-modes";
import type { TuiSlashCommandRuntime } from "../src/slash-commands/types";
import type { StatusLineSegmentId } from "@oh-my-pi/pi-tui/status-line/types";
import { getSettingDef } from "@oh-my-pi/pi-tui/overlays/settings-defs";
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
function renderBar(): { content: string; left: readonly StatusLineSegmentId[]; right: readonly StatusLineSegmentId[] } {
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

interface SettingsOverlayHarness {
	ctx: InteractiveModeContext;
	/** Resolves with the mounted overlay, so the test awaits the mount itself. */
	mounted: Promise<{ handleInput: (data: string) => void }>;
	/** The bar the close path left behind, drawn the way the editor draws it. */
	bar: () => { content: string; left: readonly StatusLineSegmentId[]; right: readonly StatusLineSegmentId[] };
}

/**
 * A controller context complete enough to mount the real settings overlay.
 * Every call the close path makes is routed into a real `StatusLineComponent`,
 * so what the test reads afterwards is the bar that path produced.
 */
function settingsOverlayHarness(): SettingsOverlayHarness {
	const component = statusLines.track(new StatusLineComponent(makeSession(), statusLineHost));
	component.updateSettings(statusLineHost.getSettings());
	const mounted = Promise.withResolvers<{ handleInput: (data: string) => void }>();
	const ctx = {
		settings: Settings.instance,
		session: {
			getAvailableThinkingLevels: () => [],
			getAvailableModels: () => [],
			thinkingLevel: undefined,
			model: undefined,
		},
		editor: { getTopBorderAvailableWidth: () => 120 },
		editorContainer: { children: [] as unknown[], addChild: () => {}, clear: () => {} },
		statusLine: {
			updateSettings: (next: Parameters<typeof component.updateSettings>[0]) => component.updateSettings(next),
			invalidate: () => component.invalidate(),
			describePreview: () => component.describePreview(),
			getPreviewLines: (width: number) => component.getPreviewLines(width),
		},
		ui: {
			showOverlay: (overlay: { handleInput: (data: string) => void }) => {
				mounted.resolve(overlay);
				return { hide: () => {} };
			},
			setFocus: () => {},
			getFocused: () => undefined,
			invalidate: () => {},
			requestRender: () => {},
		},
	} as unknown as InteractiveModeContext;
	return {
		ctx,
		mounted: mounted.promise,
		bar: () => {
			const effective = component.getEffectiveSettingsForTest();
			return {
				content: stripVTControlCharacters(component.getTopBorder(200).content).trim(),
				left: effective.leftSegments,
				right: effective.rightSegments,
			};
		},
	};
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

	// The row has to offer the bar that is actually on screen, in every
	// configuration, because the row's first edit is a write of the whole list.
	// `custom` reads the two halves when no merged list is configured, so
	// flattening the `custom` preset's stock order described a bar nobody was
	// looking at: eight left and two right over a two-left, one-right bar, and
	// the first edit committed that stock list over the configured halves.
	// Asserted through the real store, host and component in all four states
	// rather than against a literal, so a future change to the renderer's own
	// fallback cannot quietly diverge from the row again.
	const rowParityCases: Array<[string, () => void]> = [
		[
			"custom with only the legacy halves configured",
			() => {
				cfgStatusLinePreset.set(Settings.instance, "custom");
				cfgStatusLineLeftSegments.set(Settings.instance, ["pi", "model"]);
				cfgStatusLineRightSegments.set(Settings.instance, ["session_name"]);
			},
		],
		[
			"custom with a merged list configured",
			() => {
				cfgStatusLinePreset.set(Settings.instance, "custom");
				cfgStatusLineSegments.set(Settings.instance, ["pi", "model", "cost", "session_name"]);
			},
		],
		[
			// Not a parity case, and deliberately kept out of the loop below.
			// `custom` with nothing configured draws its halves from the
			// schema defaults, whose right half holds `cost` and `context_pct`.
			// Both are left-side segments on every preset, so
			// `END_OF_BAR_SEGMENTS` excludes them and the row's flatten-then-split
			// round trip hands them back on the left. The row is one list and the
			// split is global, so it cannot express "these two are on the right".
			// That is the limitation the PR body documents, and it is unchanged
			// by the fallback fix: asserted on its own terms in the test below.
			"custom with nothing configured",
			() => cfgStatusLinePreset.set(Settings.instance, "custom"),
		],
		["default with nothing configured", () => cfgStatusLinePreset.set(Settings.instance, "default")],
	];

	for (const [label, configure] of rowParityCases.filter(([label]) => !label.startsWith("custom with nothing"))) {
		it(`offers the segments the live bar draws: ${label}`, () => {
			configure();

			const bar = renderBar();
			// The row is one list; the bar re-splits it on the end-of-bar set,
			// so compare what the row would actually draw once saved.
			const offered = centerBarSegments(createSettingsHost());

			expect(offered.filter(segment => !END_OF_BAR_SEGMENTS.has(segment))).toEqual([...bar.left]);
			expect(offered.filter(segment => END_OF_BAR_SEGMENTS.has(segment))).toEqual([...bar.right]);
		});
	}

	// The one case parity cannot reach, pinned so it stays visible. The row
	// offers the same *set* the bar draws, in left-then-right order, and loses
	// only which end `cost` and `context_pct` sit on.
	it("offers the custom halves as a set, losing only the end for left-side segments", () => {
		cfgStatusLinePreset.set(Settings.instance, "custom");

		const bar = renderBar();
		const offered = centerBarSegments(createSettingsHost());

		expect([...offered].sort()).toEqual([...bar.left, ...bar.right].sort());
		// The bar keeps them on the right; the row's split cannot.
		expect([...bar.right]).toContain("cost");
		expect(offered.filter(segment => END_OF_BAR_SEGMENTS.has(segment))).not.toContain("cost");
	});

	// The end-of-bar split is a known limitation and is documented in the PR
	// body: a legacy user whose right half holds a segment some preset places
	// on the left will see it move ends on the first edit. Pinned here so the
	// limitation stays visible rather than being rediscovered.
	it("moves a right-half segment some preset puts on the left, as documented", () => {
		cfgStatusLinePreset.set(Settings.instance, "custom");
		cfgStatusLineLeftSegments.set(Settings.instance, ["model"]);
		cfgStatusLineRightSegments.set(Settings.instance, ["pi"]);

		const before = renderBar();
		expect(before.left).toEqual(["model"]);
		expect(before.right).toEqual(["pi"]);

		const row = centerBarSegments(createSettingsHost());
		// `pi` is a left segment on every preset, so saving the row's own order
		// puts it back on the left. The row cannot express "right" for it.
		expect(row.filter(segment => END_OF_BAR_SEGMENTS.has(segment))).toEqual([]);
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

	// `/statusline` exists to land the user on the segment chooser. It named a
	// path that declares no `ui` metadata, so no row exists for it and the
	// selector opened on the first Appearance row instead, Dark Theme. Dispatch
	// the command the way the user does and check the path it passes actually
	// resolves to a row, so a future rename cannot silently break the link again.
	it("deep-links /statusline to the Center Bar row", async () => {
		const command = BUILTIN_MODE_SLASH_COMMANDS.find(entry => entry.name === "statusline");
		if (!command?.handleTui) throw new Error("/statusline has no TUI handler");
		const focusPaths: (string | undefined)[] = [];
		const runtime = {
			draftDetached: true,
			ctx: {
				settings: Settings.instance,
				showSettingsSelector: (path?: string) => void focusPaths.push(path),
				showStatus: () => {},
				statusLine: { invalidate: () => {} },
				ui: { requestRender: () => {} },
			},
		} as unknown as TuiSlashCommandRuntime;

		await command.handleTui({ name: "statusline", args: "", text: "statusline" }, runtime);

		expect(focusPaths).toEqual([cfgStatusLineSegments.id]);
		const def = getSettingDef(createSettingsHost().entries, focusPaths[0] ?? "");
		if (!def) throw new Error(`/statusline targets ${focusPaths[0]}, which is not a settings row`);
		expect(def.label).toBe("Center Bar");
	});
	// Closing the settings overlay is the only way to leave it, and the close
	// path re-seeds the bar. It re-seeded the bar from the merged list alone, so a
	// config that only ever set the two halves drew correctly while the overlay
	// was open and fell back to the stock Custom baseline the moment the user
	// pressed Escape. Driven through the real overlay and the real renderer: the
	// assertion is what the bar draws after the overlay is gone, not what the
	// close handler passed in.
	it("keeps the configured halves when /settings is closed", async () => {
		cfgStatusLinePreset.set(Settings.instance, "custom");
		cfgStatusLineLeftSegments.set(Settings.instance, ["model"]);
		cfgStatusLineRightSegments.set(Settings.instance, ["session_name", "session"]);

		const before = renderBar();
		expect(before.right).toEqual(["session_name", "session"]);

		const harness = settingsOverlayHarness();
		new SelectorController(harness.ctx).showSettingsSelector();
		const overlay = await harness.mounted;

		// Escape is the key that closes the panel.
		overlay.handleInput("\x1b");

		const after = harness.bar();
		expect(after.right).toEqual(["session_name", "session"]);
		expect(after.left).toEqual(["model"]);
		expect(after.content).toContain("legacy-session");
		expect(after.content).toContain("Sonnet 5");
	});
});
