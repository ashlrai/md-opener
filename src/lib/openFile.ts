import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useDocumentStore } from "../store/documentStore";

const MD_FILTERS = [
  { name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd", "mdx"] },
];

/** Show the native open panel and load the chosen Markdown file. */
export async function pickAndOpen(): Promise<void> {
  const selected = await openDialog({ multiple: false, filters: MD_FILTERS });
  if (typeof selected === "string") {
    await useDocumentStore.getState().openPath(selected);
  }
}
