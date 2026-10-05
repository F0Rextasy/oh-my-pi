import { describe, expect, it } from "bun:test";
import { cfgStatusLineSegments, cfgStatusLineLeftSegments, cfgStatusLineRightSegments } from "../src/modes/settings";
import { STATUS_LINE_SEGMENT_IDS } from "@oh-my-pi/pi-tui/status-line/schema";
import { createSettingsHost } from "../src/config/settings-ui";
import { getSettingDef } from "@oh-my-pi/pi-tui/overlays/settings-defs";

/**
 * The segment lists were reachable only by hand-editing `config.yml`: the
 * settings overlay hides an array that declares no `ui.options` ("arrays
 * without declared options stay config-file only"), so picking which segments
 * the bar shows was impossible from the TUI. These tests pin the two things
 * that make it possible, so a regression cannot quietly hide them again.
 */

/**
 * The bar is one line, so it is edited as one list. Before this change the two
 * half-lists carried no `ui.options` and the settings overlay hid them — which
 * meant picking the bar's segments was impossible from the TUI at all.
 *
 * These tests pin the one thing that made it possible, so a regression cannot
 * quietly hide the chooser again.
 */
describe("status line segment chooser", () => {
	it("offers every segment id as a checkbox, with a label and description", () => {
		// `ui` is a union across setting kinds; only the array form carries
		// `options`, and this test exists to prove the array form has them.
		const options = (cfgStatusLineSegments.definition.ui as { options?: unknown } | undefined)?.options;
		expect(Array.isArray(options)).toBe(true);
		const byValue = new Map(
			(options as { value: string; label: string; description: string }[]).map(o => [o.value, o]),
		);
		expect(byValue.size).toBe(STATUS_LINE_SEGMENT_IDS.length);
		for (const id of STATUS_LINE_SEGMENT_IDS) {
			expect(byValue.get(id)?.label, `${id} needs a label`).toBeTruthy();
			expect(byValue.get(id)?.description, `${id} needs a description`).toBeTruthy();
		}
	});

	it("does not leak the internal half-lists into the overlay", () => {
		// The renderer still reads `leftSegments`/`rightSegments` for the presets,
		// but a user-facing row per half would tell them the bar is two bars.
		for (const setting of [cfgStatusLineLeftSegments, cfgStatusLineRightSegments]) {
			expect((setting.definition.ui as { label?: string } | undefined)?.label).toBeUndefined();
		}
	});

	it("accepts every segment id", () => {
		// `items` lives only on the array form of a setting definition.
		const items = (cfgStatusLineSegments.definition as { items?: { values: readonly string[] } }).items;
		expect(items?.values).toEqual(STATUS_LINE_SEGMENT_IDS);
	});

	// The row's own description promises the bar "as one list, in order", and the
	// editor only offers order when the setting asks for it: positions, drag,
	// ←/→ and 1-9 placement are all gated on this flag. Without it the chooser is
	// membership-only, every segment the user adds lands at the end of the list,
	// and there is no way to move one.
	it("opens the chooser as an ordered list", () => {
		const def = getSettingDef(createSettingsHost().entries, cfgStatusLineSegments.id);
		if (def?.type !== "multiselect") throw new Error(`Center Bar row resolved to ${def?.type}, not a multiselect`);
		expect(def.ordered).toBe(true);
	});
});
