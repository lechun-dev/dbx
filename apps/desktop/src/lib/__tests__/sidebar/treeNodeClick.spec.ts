import { describe, expect, it } from "vitest";
import { objectBrowserObjectTypeForTreeNode, treeNodeRowAction, treeNodeRowDoubleClickAction } from "@/lib/sidebar/treeNodeClick";

describe("treeNodeClick", () => {
  it("opens the matching object browser category when a group label is clicked", () => {
    expect(treeNodeRowAction("group-tables", true, "single", true)).toBe("open-object-browser");
    expect(treeNodeRowAction("group-views", true, "single", true)).toBe("open-object-browser");
    expect(treeNodeRowAction("group-functions", true, "single", true)).toBe("open-object-browser");
    expect(objectBrowserObjectTypeForTreeNode("group-tables")).toBe("tables");
    expect(objectBrowserObjectTypeForTreeNode("group-views")).toBe("views");
    expect(objectBrowserObjectTypeForTreeNode("group-functions")).toBe("functions");
  });

  it("defaults database and schema navigation to tables", () => {
    expect(treeNodeRowAction("database", true, "single", true)).toBe("open-object-browser");
    expect(treeNodeRowAction("schema", true, "single", true)).toBe("open-object-browser");
    expect(objectBrowserObjectTypeForTreeNode("database")).toBe("tables");
    expect(objectBrowserObjectTypeForTreeNode("schema")).toBe("tables");
  });

  it("keeps object groups on double-click activation when configured", () => {
    expect(treeNodeRowAction("group-tables", true, "double", true)).toBe("none");
    expect(treeNodeRowDoubleClickAction("group-tables", true, "double", true)).toBe("open-object-browser-and-expand");
    expect(treeNodeRowDoubleClickAction("group-views", true, "double", true)).toBe("open-object-browser-and-expand");
  });

  it("keeps unsupported tables groups expandable", () => {
    expect(treeNodeRowAction("group-tables", true, "single", false)).toBe("toggle");
  });
});
