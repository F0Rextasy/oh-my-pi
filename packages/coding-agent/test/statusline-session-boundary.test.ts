import { beforeAll, afterEach, describe, expect, it } from "bun:test";
import { CommandController } from "@oh-my-pi/pi-coding-agent/modes/controllers/command-controller";
import { initTheme } from "@oh-my-pi/pi-tui/theme";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import { cfgStatusLinePreset, cfgStatusLineSegments } from "@oh-my-pi/pi-coding-agent/modes/settings";

/**
 * `/new` must not touch the status line's settings.
 *
 * These are the only two writers of the bar's configuration: the segment-list
 * edit and `/statusline reset`. If a session boundary ever grew a line that
 * reset the bar, the user would lose a configuration they set deliberately and
 * had no reason to expect to lose — and nothing else in the product would say so.
 *
 * The test therefore counts writes rather than inspecting the panel afterwards:
 * the assertion has to survive a future rewrite of how the settings overlay
 * renders, which is exactly the layer this feature changes.
 */

beforeAll(async () => {
	await initTheme(false);
});

interface Harness {
	ctx: InteractiveModeContext;
	controller: CommandController;
}

function makeHarness(): Harness {
	const ctx = {
		session: {
			isCompacting: false,
			newSession: async () => true,
		},
		sessionManager: { getSessionName: () => undefined, getCwd: () => "/tmp" },
		focusedAgentId: undefined,
		unfocusSession: async () => {},
		eventController: { resetTranscriptAnchors: () => {} },
		resetObserverRegistry: () => {},
		statusLine: { invalidate: () => {}, resetActiveTime: () => {} },
		updateEditorBorderColor: () => {},
		clearTransientSessionUi: () => {},
		resetTranscript: () => {},
		present: () => {},
		reloadTodos: async () => {},
		ui: { requestRender: () => {} },
	} as unknown as InteractiveModeContext;
	return { ctx, controller: new CommandController(ctx) };
}

/** Counts every write to the two settings that shape the bar. */
function countBarWrites(): () => number {
	let writes = 0;
	const originals = [
		[cfgStatusLinePreset, "set"],
		[cfgStatusLineSegments, "set"],
	] as const;
	const patched = originals.map(([setting, method]) => {
		const original = setting[method] as (...args: unknown[]) => unknown;
		(setting as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
			writes++;
			return original.apply(setting, args);
		};
		return [setting, method, original] as const;
	});
	afterEach(() => {
		for (const [setting, method, original] of patched) {
			(setting as unknown as Record<string, unknown>)[method] = original;
		}
	});
	return () => writes;
}

describe("/new and status line settings", () => {
	it("writes no bar setting while starting a new session", async () => {
		const writes = countBarWrites();
		const harness = makeHarness();

		await harness.controller.handleClearCommand();

		expect(writes()).toBe(0);
	});

	// The same guarantee through the other session-boundary command, so a fix
	// that protects `/new` but not `/clear` is caught.
	it("writes no bar setting while clearing the context in place", async () => {
		const writes = countBarWrites();
		const harness = makeHarness();
		harness.ctx.session.resetSessionContext = async () => ({ droppedCount: 0 });

		await harness.controller.handleResetContextCommand();

		expect(writes()).toBe(0);
	});
});
