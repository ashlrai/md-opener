/**
 * pasteImage.ts — shared clipboard-image paste handling for the editors.
 *
 * When the user pastes an image, we save its bytes next to the open document
 * (via the `save_pasted_image` Rust command, which confines the write to the
 * document's own folder) and hand back a Markdown-relative reference to insert.
 * Both the CodeMirror source editor and the Milkdown WYSIWYG editor route their
 * paste events through {@link handleImagePaste}.
 */

import { invoke } from "@tauri-apps/api/core";
import { useDocumentStore } from "../store/documentStore";
import { toast } from "../store/toastStore";

/** MIME → file extension for the image types the backend allowlist accepts. */
const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

/** The first clipboard item that is a supported image, or null. */
function firstImageItem(items: DataTransferItemList | null): DataTransferItem | null {
  if (!items) return null;
  for (const item of items) {
    if (item.kind === "file" && MIME_TO_EXT[item.type]) return item;
  }
  return null;
}

/**
 * If `clipboard` carries a supported image, save it next to the open document
 * and return the `![](<relativePath>)` Markdown to insert at the cursor.
 *
 * Returns `null` when there's no image to handle (the caller should let the
 * default paste proceed). When an image IS present but can't be handled
 * (unsaved document, read/save failure), this shows a toast and returns `null`
 * after the caller has already prevented default — so nothing wrong is inserted.
 *
 * Callers should check {@link clipboardHasImage} first to decide whether to
 * `preventDefault()`, then await this for the markdown.
 */
export async function handleImagePaste(
  clipboard: DataTransfer | null,
): Promise<string | null> {
  const item = firstImageItem(clipboard?.items ?? null);
  if (!item) return null;

  const docPath = useDocumentStore.getState().path;
  if (!docPath) {
    toast.info("Save the document before pasting images");
    return null;
  }

  const blob = item.getAsFile();
  if (!blob) return null;
  const ext = MIME_TO_EXT[blob.type];
  if (!ext) return null;

  try {
    const buf = new Uint8Array(await blob.arrayBuffer());
    const relPath = await invoke<string>("save_pasted_image", {
      docPath,
      bytes: Array.from(buf),
      ext,
    });
    return `![](${relPath})`;
  } catch (e) {
    toast.error(`Could not save pasted image: ${String(e)}`);
    return null;
  }
}

/** True if the clipboard carries at least one supported image file. */
export function clipboardHasImage(clipboard: DataTransfer | null): boolean {
  return firstImageItem(clipboard?.items ?? null) !== null;
}
