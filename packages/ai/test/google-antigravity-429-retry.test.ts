/**
 * Antigravity detail-free 429 RESOURCE_EXHAUSTED retry contract (issue #12655).
 *
 * The Cloud Code Assist API returns the bare gRPC boilerplate
 * "Resource has been exhausted (e.g. check quota)." with no quota/reset detail.
 * That must classify as transient MODEL_CAPACITY_EXHAUSTED — bounded
 * retry-with-backoff honoring Retry-After — never as QUOTA_EXHAUSTED (whose
 * 30-minute heuristic exceeds retry.maxDelayMs, so the turn surfaced a raw 429
 * after a single attempt on a quota-healthy account). Bodies carrying a real
 * quota signal keep their authoritative QUOTA_EXHAUSTED classification.
 */
import { describe, expect, it } from "bun:test";
import { extractRetryHint } from "@oh-my-pi/pi-utils/fetch-retry";
import * as AIError from "@oh-my-pi/pi-ai/error";
import {
	calculateRateLimitBackoffMs,
	isUsageLimitOutcome,
	parseRateLimitReason,
} from "@oh-my-pi/pi-ai/error/rate-limit";

const DETAIL_FREE_429_BODY = JSON.stringify({
	error: {
		code: 429,
		message: "Resource has been exhausted (e.g. check quota).",
		status: "RESOURCE_EXHAUSTED",
	},
});

describe("antigravity detail-free 429 classification", () => {
	it("maps the boilerplate to MODEL_CAPACITY_EXHAUSTED instead of QUOTA_EXHAUSTED", () => {
		expect(parseRateLimitReason(`Cloud Code Assist API error (429): ${DETAIL_FREE_429_BODY}`)).toBe(
			"MODEL_CAPACITY_EXHAUSTED",
		);
	});

	it("stays out of the credential-rotation lane", () => {
		expect(isUsageLimitOutcome(429, `Cloud Code Assist API error (429): ${DETAIL_FREE_429_BODY}`)).toBe(false);
	});

	it("keeps real quota detail authoritative", () => {
		const withQuota =
			"Cloud Code Assist API error (429): Resource has been exhausted (e.g. check quota). Quota exceeded for project.";
		expect(parseRateLimitReason(withQuota)).toBe("QUOTA_EXHAUSTED");
		expect(isUsageLimitOutcome(429, withQuota)).toBe(true);
	});

	// The detail-free shortcut must mean "no account-scoped signal anywhere in
	// the body", not "no signal except the three words the first guard listed".
	// Each detail below is a real per-account exhaustion the ladder recognises;
	// swallowing it under the boilerplate strands the credential on short
	// retries instead of rotating it.
	const ACCOUNT_SCOPED_DETAILS: ReadonlyArray<readonly [string, string]> = [
		["credits exhausted", "Credits exhausted."],
		["exceeded credits", "You exceeded your available credits for this project."],
		["prepaid balance", "Your prepaid balance is exhausted."],
		["spend limit", "Your project has exceeded its monthly spending cap."],
		["account-scoped rate limit", "Your account rate limit has been reached."],
		["quota reset", "Your quota will reset at 2026-10-06 20:00."],
	];

	for (const [label, detail] of ACCOUNT_SCOPED_DETAILS) {
		it(`keeps the ${label} signal authoritative alongside the boilerplate`, () => {
			const message = `Cloud Code Assist API error (429): Resource has been exhausted (e.g. check quota). ${detail}`;
			expect(parseRateLimitReason(message)).toBe("QUOTA_EXHAUSTED");
			expect(isUsageLimitOutcome(429, message)).toBe(true);
		});
	}

	it("classifies the surfaced provider error as transient and retriable", () => {
		const error = new AIError.GeminiCliApiError(`Cloud Code Assist API error (429): ${DETAIL_FREE_429_BODY}`, 429);
		expect(AIError.isUsageLimit(error)).toBe(false);
		expect(AIError.is(AIError.classify(error), AIError.Flag.Transient)).toBe(true);
		expect(AIError.retriable(AIError.classify(error))).toBe(true);
	});
});

describe("antigravity detail-free 429 retry budget", () => {
	it("backoff for the detail-free 429 stays within the session retry cap", () => {
		const errorText = `Cloud Code Assist API error (429): ${DETAIL_FREE_429_BODY}`;
		// A provider Retry-After hint wins when present …
		expect(extractRetryHint(new Headers({ "retry-after": "2" }), errorText)).toBe(2_000);
		// … and the heuristic fallback (no header) must fit under the default
		// 60s session cap, unlike the 30-minute QUOTA_EXHAUSTED wait that caused
		// the raw single-attempt 429 surface in #12655.
		const fallbackMs = calculateRateLimitBackoffMs(parseRateLimitReason(errorText));
		expect(fallbackMs).toBeLessThanOrEqual(120_000);
	});
});
