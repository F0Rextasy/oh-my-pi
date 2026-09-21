/**
 * Local Laya judge backend: a {@link Judge} over the laya-judge HTTP sidecar.
 *
 * Forwards a {@link JudgmentRequest} verbatim to `POST {baseUrl}/judge` and
 * maps the typed answers back, exactly like {@link TypeSafeJudge} does for the
 * System One API. Zero tokens, zero cost; usage journals as all-zero.
 *
 * Opt-in only: constructed solely when `LAYA_JUDGE_URL` is set (see
 * `ChainJudge`), so an unset variable leaves the judge chain untouched.
 */
import type { FetchImpl } from "@oh-my-pi/pi-catalog/types";
import { $env } from "@oh-my-pi/pi-utils";
import * as AIError from "../error";
import {
	type Judge,
	type JudgeOptions,
	type JudgmentRequest,
	type JudgmentResult,
	type Questions,
	tokenUsage,
} from "./types";

export const LAYA_PROVIDER = "laya";
export const LAYA_DEFAULT_MODEL = "laya-rl-agent";

/** `LAYA_JUDGE_URL` when set (sidecar root, e.g. `http://127.0.0.1:3777`); empty means disabled. */
export function layaJudgeUrl(): string {
	return ($env.LAYA_JUDGE_URL?.trim() ?? "").replace(/\/+$/, "");
}

export interface LayaJudgeOptions {
	/** Sidecar root; defaults to {@link layaJudgeUrl}. */
	baseUrl?: string;
	/** Reported model when the sidecar omits one; defaults to {@link LAYA_DEFAULT_MODEL}. */
	model?: string;
	fetch?: FetchImpl;
	/** Per-attempt timeout; defaults to 30s (CPU inference, first call loads). */
	timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

interface LayaSidecarResponse {
	model?: string;
	answers: Record<string, { type?: string } & Record<string, unknown>>;
}

export class LayaJudge implements Judge {
	readonly label: string;
	readonly provider = LAYA_PROVIDER;
	readonly model: string;
	readonly baseUrl: string;
	readonly #fetch: FetchImpl;
	readonly #timeoutMs: number;

	constructor(options: LayaJudgeOptions = {}) {
		this.baseUrl = (options.baseUrl ?? layaJudgeUrl()).replace(/\/+$/, "");
		this.model = options.model ?? LAYA_DEFAULT_MODEL;
		this.#fetch = options.fetch ?? fetch;
		this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		this.label = `${this.provider}/${this.model}`;
	}

	async judge<Q extends Questions>(request: JudgmentRequest<Q>, options?: JudgeOptions): Promise<JudgmentResult<Q>> {
		const body = JSON.stringify({ state: request.state, questions: request.questions });
		const signal = options?.signal;
		const timeout = AbortSignal.timeout(this.#timeoutMs);
		const response = await this.#fetch(`${this.baseUrl}/judge`, {
			method: "POST",
			headers: { Accept: "application/json", "Content-Type": "application/json" },
			body,
			signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
		});
		if (!response.ok) {
			throw new AIError.ProviderResponseError(`${this.label} API error (${response.status})`, {
				provider: this.provider,
				kind: "envelope",
			});
		}
		const json = (await response.json()) as LayaSidecarResponse;
		for (const id in request.questions) {
			const answer = json.answers?.[id];
			if (answer === undefined || answer.type !== request.questions[id].type) {
				throw new AIError.ProviderResponseError(
					`${this.label} response is missing a "${request.questions[id].type}" answer for question "${id}"`,
					{ provider: this.provider, kind: "envelope" },
				);
			}
		}
		return {
			api: LAYA_PROVIDER,
			provider: this.provider,
			model: json.model ?? this.model,
			answers: json.answers as unknown as JudgmentResult<Q>["answers"],
			usage: tokenUsage(0, 0, 0),
		};
	}
}
