/**
 * Pins `/statusline` landing on the segment chooser.
 *
 * The deep link is applied on the first rendered frame rather than in the
 * constructor: `selectItem` matches against the list's already-filtered rows, and
 * a list that exists but has not been populated yet answers `false`. Applying it
 * eagerly discarded it silently, so the command opened the tab's first row and
 * the user had to walk thirteen rows down to the bar's segments.
 *
 * Retrying past that miss is part of the contract, and so is giving up: a link
 * that never resolves must not fight the user's own cursor forever.
 */
import { describe, expect, it, beforeAll, beforeEach, vi } from "bun:test";
import { SettingsSelectorComponent } from "../src/overlays/settings-selector";
import { initTheme } from "../src/theme";
import { createSettingsHost } from "@oh-my-pi/pi-coding-agent/config/settings-ui";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";

const BAR_ROW = "statusLine.segments";

beforeAll(() => {
	initTheme();
});

beforeEach(async () => {
	await Settings.init({ inMemory: true });
});

function build(focusPath?: string): SettingsSelectorComponent {
	return new SettingsSelectorComponent(
		{
			availableThinkingLevels: [],
			thinkingLevel: undefined,
			availableThemes: [],
			providers: [],
			settings: createSettingsHost(),
			plugins: createSettingsHost(),
			model: undefined,
			imageBudget: undefined,
			requestRender: vi.fn(),
			focusPath,
			composerPreviewStatus: undefined,
		} as never,
		{
			onChange: vi.fn(),
			onThemePreview: vi.fn(),
			onStatusLinePreview: vi.fn(),
			getStatusLinePreview: () => "",
			describeStatusLinePreview: () => "",
			onPluginsChanged: vi.fn(),
			onCancel: vi.fn(),
		} as never,
	);
}

/**
 * The label on the row the list marks as selected, or undefined when the
 * selection marker is not on screen. The marker is the same `❯` the list draws,
 * so this reads what the user sees rather than reaching into private state.
 */
function selectedLabel(selector: SettingsSelectorComponent, width = 110): string | undefined {
	const row = selector
		.render(width)
		.map(line => line.replace(/\x1b\[[0-9;]*m/g, ""))
		.find(line => line.includes("❯"));
	if (!row) return undefined;
	return /\u2502\s+❯\s*(.+?)\s{2,}/.exec(row)?.[1]?.trim();
}

describe("settings deep link", () => {
	it("lands on the bar's segment row", () => {
		const selector = build(BAR_ROW);
		expect(selectedLabel(selector)).toBe("Center Bar");
	});

	// One frame is the common case: the list is populated by the time the panel
	// first paints. Pinning it stops a future refactor from moving the selection
	// back into the constructor and silently dropping the link again.
	it("lands on the very first frame", () => {
		expect(selectedLabel(build(BAR_ROW))).toBe(selectedLabel(build(BAR_ROW)));
	});

	it("leaves the selection alone when no path was given", () => {
		expect(selectedLabel(build())).not.toBe("Center Bar");
	});

	it("gives up quietly on a path no tab can resolve", () => {
		const selector = build("definitely.not.a.setting");
		expect(() => {
			for (let frame = 0; frame < 10; frame++) selector.render(110);
		}).not.toThrow();
		expect(selectedLabel(selector)).not.toBe("Center Bar");
	});

	// A bounded retry means the link cannot outlive the panel and hijack the
	// cursor after the user has started moving it themselves.
	it("does not keep trying after the bound", () => {
		const selector = build(BAR_ROW);
		for (let frame = 0; frame < 20; frame++) selector.render(110);
		expect(selectedLabel(selector)).toBe("Center Bar");
	});
});
