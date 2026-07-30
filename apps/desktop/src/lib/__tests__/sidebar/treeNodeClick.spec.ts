import { describe, expect, it } from "vitest";
import { treeNodeRowAction, treeNodeRowDoubleClickAction } from "@/lib/sidebar/treeNodeClick";

describe("treeNodeClick", () => {
  it("opens the object browser when the tables group label is clicked", () => {
    expect(treeNodeRowAction("group-tables", true, "single", true)).toBe("open-object-browser");
  });

  it("keeps the tables group on double-click activation when configured", () => {
    expect(treeNodeRowAction("group-tables", true, "double", true)).toBe("none");
    expect(treeNodeRowDoubleClickAction("group-tables", true, "double", true)).toBe("open-object-browser-and-expand");
  });

  it("keeps unsupported tables groups expandable", () => {
    expect(treeNodeRowAction("group-tables", true, "single", false)).toBe("toggle");
  });
});
