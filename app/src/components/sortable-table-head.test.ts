import { describe, expect, it } from "vitest";
import { nextTableSortDirection } from "./sortable-table-head";

describe("nextTableSortDirection", () => {
    it("cycles descending, ascending, then no selection", () => {
        const descending = nextTableSortDirection(false);
        const ascending = nextTableSortDirection(descending);
        const unselected = nextTableSortDirection(ascending);

        expect([descending, ascending, unselected]).toEqual([
            "desc",
            "asc",
            false,
        ]);
    });
});
