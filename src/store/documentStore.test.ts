import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Tauri bridge so the store runs in plain Node/happy-dom.
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

// Isolate the document store from the persisted recents store.
const recentAdd = vi.fn();
vi.mock("./recentStore", () => ({
  useRecentStore: { getState: () => ({ add: recentAdd }) },
}));

import { useDocumentStore } from "./documentStore";

function reset() {
  useDocumentStore.setState({
    path: null,
    fileName: "",
    content: "",
    diskContent: "",
    size: 0,
    isLoading: false,
    error: null,
    viewMode: "read",
    isDirty: false,
    externalChange: false,
    pendingDisk: null,
    reloadNonce: 0,
  });
}

function readReturns(content: string) {
  invokeMock.mockImplementation((cmd: string) =>
    cmd === "read_markdown_file"
      ? Promise.resolve({
          path: "/a.md",
          file_name: "a.md",
          content,
          size: content.length,
        })
      : Promise.resolve(),
  );
}

describe("documentStore", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    reset();
  });

  it("opens a file clean and starts watching it", async () => {
    readReturns("# Hello");
    await useDocumentStore.getState().openPath("/a.md");
    const s = useDocumentStore.getState();
    expect(s.path).toBe("/a.md");
    expect(s.content).toBe("# Hello");
    expect(s.diskContent).toBe("# Hello");
    expect(s.isDirty).toBe(false);
    expect(invokeMock).toHaveBeenCalledWith("watch_file", { path: "/a.md" });
  });

  it("marks dirty on edit and clean again on save", async () => {
    readReturns("x");
    await useDocumentStore.getState().openPath("/a.md");

    useDocumentStore.getState().setContent("x changed");
    expect(useDocumentStore.getState().isDirty).toBe(true);

    await useDocumentStore.getState().save();
    expect(invokeMock).toHaveBeenCalledWith("write_markdown_file", {
      path: "/a.md",
      content: "x changed",
    });
    const s = useDocumentStore.getState();
    expect(s.isDirty).toBe(false);
    expect(s.diskContent).toBe("x changed");
  });

  it("editing back to the on-disk content clears dirty", async () => {
    readReturns("original");
    await useDocumentStore.getState().openPath("/a.md");
    useDocumentStore.getState().setContent("edited");
    expect(useDocumentStore.getState().isDirty).toBe(true);
    useDocumentStore.getState().setContent("original");
    expect(useDocumentStore.getState().isDirty).toBe(false);
  });

  it("auto-reloads on external change when there are no local edits", () => {
    useDocumentStore.setState({
      path: "/a.md",
      content: "old",
      diskContent: "old",
      isDirty: false,
    });
    const before = useDocumentStore.getState().reloadNonce;
    useDocumentStore.getState().handleDiskUpdate("new from disk");
    const s = useDocumentStore.getState();
    expect(s.content).toBe("new from disk");
    expect(s.diskContent).toBe("new from disk");
    expect(s.externalChange).toBe(false);
    expect(s.reloadNonce).toBe(before + 1);
  });

  it("flags a conflict on external change with local edits, then accept reloads", () => {
    useDocumentStore.setState({
      path: "/a.md",
      content: "mine",
      diskContent: "old",
      isDirty: true,
    });
    useDocumentStore.getState().handleDiskUpdate("theirs");
    let s = useDocumentStore.getState();
    expect(s.externalChange).toBe(true);
    expect(s.pendingDisk).toBe("theirs");
    expect(s.content).toBe("mine"); // edits preserved until the user decides

    useDocumentStore.getState().acceptExternalChange();
    s = useDocumentStore.getState();
    expect(s.content).toBe("theirs");
    expect(s.isDirty).toBe(false);
    expect(s.externalChange).toBe(false);
    expect(s.pendingDisk).toBeNull();
  });

  it("dismissing a conflict keeps the local edits", () => {
    useDocumentStore.setState({
      path: "/a.md",
      content: "mine",
      diskContent: "old",
      isDirty: true,
      externalChange: true,
      pendingDisk: "theirs",
    });
    useDocumentStore.getState().dismissExternalChange();
    const s = useDocumentStore.getState();
    expect(s.externalChange).toBe(false);
    expect(s.content).toBe("mine");
    expect(s.isDirty).toBe(true);
  });

  it("treats our own save echo (disk == content) as a no-op resync", () => {
    useDocumentStore.setState({
      path: "/a.md",
      content: "same",
      diskContent: "old",
      isDirty: true,
    });
    useDocumentStore.getState().handleDiskUpdate("same");
    const s = useDocumentStore.getState();
    expect(s.isDirty).toBe(false);
    expect(s.diskContent).toBe("same");
    expect(s.externalChange).toBe(false);
  });
});
