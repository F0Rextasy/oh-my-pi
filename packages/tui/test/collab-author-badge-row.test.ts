import { beforeEach, describe, expect, it } from "bun:test";
import { UserMessageComponent } from "@oh-my-pi/pi-tui/chat/user-message";
import { initTheme } from "@oh-my-pi/pi-tui/theme";
import { visibleWidth } from "@oh-my-pi/pi-tui/utils";

describe("collab author badge row", () => {
	beforeEach(async () => {
		await initTheme();
	});

	it("keeps every rendered line within the width with a long author name", () => {
		const user = new UserMessageComponent("run the suite", {
			authorBadge: "A Very Long Collaborator Name · host",
		});
		for (const line of user.render(40)) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(40);
		}
	});

	it("still shows a short badge in full", () => {
		const user = new UserMessageComponent("run the suite", { authorBadge: "Bo · host" });
		const text = user.render(40).join("\n");
		expect(text).toContain("Bo · host");
	});
});
