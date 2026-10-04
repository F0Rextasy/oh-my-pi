import { describe, expect, it } from "bun:test";
import { streamAnthropic } from "@oh-my-pi/pi-ai/providers/anthropic";
import { streamOpenAIResponses } from "@oh-my-pi/pi-ai/providers/openai-responses";
import type { Context, FetchImpl, Model, ModelSpec } from "@oh-my-pi/pi-ai/types";
import { buildModel } from "@oh-my-pi/pi-catalog/build";

import { withOfficialAnthropicEndpoint } from "./helpers";

/**
 * `compat.extraBody` is a documented user-facing escape hatch: it merges
 * verbatim top-level keys into the outgoing request body so a proxy or a
 * vendor endpoint can be routed with fields the transport does not model.
 * It used to be accepted by the config schema and then dropped before the
 * request for every API except chat completions (#12087).
 */

const CONTEXT: Context = {
	messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
};

function createSseResponse(events: unknown[]): Response {
	const payload = `${events.map(event => `data: ${JSON.stringify(event)}`).join("\n\n")}\n\n`;
	return new Response(payload, { status: 200, headers: { "content-type": "text/event-stream" } });
}

async function captureResponsesBody(model: Model<"openai-responses">): Promise<Record<string, unknown>> {
	const { promise, resolve } = Promise.withResolvers<Record<string, unknown>>();
	const fetchMock: FetchImpl = Object.assign(
		async (_input: string | URL | Request, init?: RequestInit) => {
			if (typeof init?.body === "string") resolve(JSON.parse(init.body) as Record<string, unknown>);
			return createSseResponse([
				{
					type: "response.completed",
					response: {
						status: "completed",
						output: [],
						usage: { input_tokens: 0, output_tokens: 0, input_tokens_details: { cached_tokens: 0 } },
					},
				},
			]);
		},
		{ preconnect: fetch.preconnect },
	);

	const stream = streamOpenAIResponses(model, CONTEXT, { apiKey: "sk-test", fetch: fetchMock });
	for await (const event of stream) {
		if (event.type === "done" || event.type === "error") break;
	}
	return promise;
}

async function captureAnthropicPayload(model: Model<"anthropic-messages">): Promise<Record<string, unknown>> {
	const { promise, resolve } = Promise.withResolvers<Record<string, unknown>>();
	streamAnthropic(model, CONTEXT, {
		apiKey: "sk-ant-test",
		onPayload: payload => resolve(payload as Record<string, unknown>),
	});
	return promise;
}

function responsesModel(compat: Record<string, unknown>): Model<"openai-responses"> {
	return buildModel({
		api: "openai-responses",
		reasoning: false,
		provider: "openai",
		id: "gpt-5.6",
		name: "GPT-5.6",
		baseUrl: "https://api.openai.com/v1",
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 400_000,
		maxTokens: 128_000,
		compat,
	} as ModelSpec<"openai-responses">);
}

function anthropicModel(compat: Record<string, unknown>): Model<"anthropic-messages"> {
	return buildModel({
		api: "anthropic-messages",
		provider: "anthropic",
		id: "claude-opus-4-8-20260528",
		name: "Claude Opus 4.8",
		baseUrl: "https://api.anthropic.com",
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1_000_000,
		maxTokens: 64_000,
		reasoning: true,
		compat,
	} as ModelSpec<"anthropic-messages">);
}

withOfficialAnthropicEndpoint();
describe("compat.extraBody reaches the wire", () => {
	it("merges a configured Responses extra body into the request", async () => {
		const body = await captureResponsesBody(responsesModel({ extraBody: { gateway: "m1-01", controller: "mlx" } }));

		expect(body.gateway).toBe("m1-01");
		expect(body.controller).toBe("mlx");
	});

	it("merges a configured Messages extra body into the request", async () => {
		const payload = await captureAnthropicPayload(
			anthropicModel({ extraBody: { gateway: "m1-01", controller: "mlx" } }),
		);

		expect(payload.gateway).toBe("m1-01");
		expect(payload.controller).toBe("mlx");
	});

	it("lets a configured extra body override a transport-owned Responses field", async () => {
		const body = await captureResponsesBody(responsesModel({ extraBody: { store: true } }));

		expect(body.store).toBe(true);
	});
});

describe("compat.extraBody outside its supported APIs", () => {
	it("never carries an extra body onto a Google API model", () => {
		const model = buildModel({
			api: "google-generative-ai",
			reasoning: false,
			provider: "gemini",
			id: "gemini-3-pro",
			name: "Gemini 3 Pro",
			baseUrl: "https://generativelanguage.googleapis.com",
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1_000_000,
			maxTokens: 64_000,
			compat: { extraBody: { gateway: "m1-01" } },
		} as ModelSpec<"google-generative-ai">);

		expect(Reflect.get(model.compat, "extraBody")).toBeUndefined();
	});
});
