import { describe, expect, it } from "vitest";
import { formatDisplayMonthDayTime } from "./datetime";

describe("formatDisplayMonthDayTime", () => {
    it("formats UTC timestamps in Japan time with a month name and 12-hour clock", () => {
        expect(formatDisplayMonthDayTime("2026-08-25T11:44:00.000Z")).toBe(
            "Aug 25, 08:44 PM",
        );
    });

    it("returns null for an invalid timestamp", () => {
        expect(formatDisplayMonthDayTime("not-a-date")).toBeNull();
    });
});
