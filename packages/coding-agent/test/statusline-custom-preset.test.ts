import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { SelectorController } from "@oh-my-pi/pi-coding-agent/modes/controllers/selector-controller";
import { cfgStatusLinePreset, cfgStatusLineSegments } from "@oh-my-pi/pi-coding-agent/modes/settings";
import { initTheme } from "@oh-my-pi/pi-tui/theme";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import { beginSettingsTest, restoreSettingsTestState, type SettingsTestState } from "./helpers/settings-test-state";

let settingsState: SettingsTestState | undefined;
let settings: Settings;

beforeAll(() => {
	initTheme();
});

beforeEach(async () => {
	settingsState = beginSettingsTest();
	settings = await Settings.init({ inMemory: true });
});

afterEach(() => {
	restoreSettingsTestState(settingsState);
	settingsState = undefined;
});

/** The controller only reaches for `settings`, `statusLine` and `ui` on this path. */
function createController(): { controller: SelectorController; invalidate: () => number } {
	const invalidate = vi.fn();
	const ctx = {
		settings,
		statusLine: { invalidate },
		ui: { invalidate: vi.fn(), requestRender: vi.fn() },
	} as unknown as InteractiveModeContext;
	return { controller: new SelectorController(ctx), invalidate: () => invalidate.mock.calls.length };
}

describe("status line segment editing", () => {
	// The bar resolves its segments from the preset unless the preset is `custom`
	// (`#computeEffectiveSettings`), so an edit made on any other preset is
	// written to settings and then ignored by the renderer. The live preview
	// disagrees with that decision, which is what made it a silent failure:
	// the user sees the bar change, commits, and finds it unchanged.
	it("switches to the custom preset when a segment list is edited", () => {
		cfgStatusLinePreset.set(settings, "default");
		const { controller } = createController();

		controller.handleSettingChange(cfgStatusLineSegments.id, ["model", "path"]);

		expect(cfgStatusLinePreset.get(settings)).toBe("custom");
	});

	it("switches on a second edit once already custom", () => {
		cfgStatusLinePreset.set(settings, "minimal");
		const { controller } = createController();

		controller.handleSettingChange(cfgStatusLineSegments.id, ["session_name"]);

		expect(cfgStatusLinePreset.get(settings)).toBe("custom");
	});

	// Once custom, the preset is already what the edit needs; re-writing it would
	// churn the settings file and invalidate the bar's render cache for nothing.
	it("leaves the custom preset alone", () => {
		cfgStatusLinePreset.set(settings, "custom");
		const { controller, invalidate } = createController();

		controller.handleSettingChange(cfgStatusLineSegments.id, ["model"]);

		expect(cfgStatusLinePreset.get(settings)).toBe("custom");
		expect(invalidate()).toBe(0);
	});

	// The bar has to re-read the preset or it keeps drawing the old segment list
	// until something else invalidates it.
	it("invalidates the bar when it takes over the preset", () => {
		cfgStatusLinePreset.set(settings, "default");
		const { controller, invalidate } = createController();

		controller.handleSettingChange(cfgStatusLineSegments.id, ["model"]);

		expect(invalidate()).toBeGreaterThan(0);
	});

	it("does not disturb an unrelated setting", () => {
		cfgStatusLinePreset.set(settings, "default");
		const { controller } = createController();

		controller.handleSettingChange("some.other.setting", "value");

		expect(cfgStatusLinePreset.get(settings)).toBe("default");
	});
});
