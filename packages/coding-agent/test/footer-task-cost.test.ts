/**
 * The footer's cost segment used to be a hand-rolled loop over session entries
 * that only counted `assistant` messages. A `task` subagent reports its spend in
 * a toolResult, so every delegated dollar was missing from the footer total.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { statusLineHost } from "@oh-my-pi/pi-coding-agent/modes/status-line-host";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { initTheme } from "@oh-my-pi/pi-tui/theme";
import { FooterComponent } from "@oh-my-pi/pi-tui/status-line/footer";

beforeAll(async () => {
	resetSettingsForTest();
	await Settings.init({ inMemory: true });
	await initTheme();
});

afterAll(() => {
	resetSettingsForTest();
});

describe("FooterComponent session cost", () => {
	it("counts a task toolResult's usage in the footer total", async () => {
		const authStorage = await AuthStorage.create(":memory:");
		const modelRegistry = new ModelRegistry(authStorage);
		const target = modelRegistry.getAll().find(candidate => candidate.contextWindow && candidate.contextWindow > 0);
		if (!target) throw new Error("Expected bundled model with a context window");

		const manager = SessionManager.inMemory();
		manager.appendMessage({ role: "user", content: "delegate this", timestamp: 1 });
		manager.appendMessage({
			role: "assistant",
			content: [{ type: "toolCall", id: "call-1", name: "task", arguments: { prompt: "work" } }],
			api: target.api,
			provider: target.provider,
			model: target.id,
			timestamp: 2,
			stopReason: "toolUse",
			usage: {
				input: 1_000,
				output: 100,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 1_100,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 1 },
			},
		});
		manager.appendMessage({
			role: "toolResult",
			toolCallId: "call-1",
			toolName: "task",
			content: [{ type: "text", text: "done" }],
			isError: false,
			timestamp: 3,
			details: {
				usage: {
					input: 5_000,
					output: 500,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 5_500,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 2 },
				},
			},
		});

		const session = new AgentSession({
			agent: new Agent({
				initialState: {
					model: target,
					systemPrompt: ["Test"],
					tools: [],
					messages: manager.buildSessionContext().messages,
				},
			}),
			sessionManager: manager,
			settings: Settings.isolated({ "compaction.enabled": false }),
			modelRegistry,
		});

		const component = new FooterComponent(
			session as unknown as ConstructorParameters<typeof FooterComponent>[0],
			statusLineHost,
		);
		try {
			const line = Bun.stripANSI(component.render(200).join("\n"));
			// $1 from the parent's assistant turn plus $2 from the subagent task result.
			expect(line).toContain("$3.000");
		} finally {
			component.dispose();
			await session.dispose();
			await manager.close();
			authStorage.close();
		}
	});
});
