/**
 * notify.ts — best-effort native OS notifications.
 *
 * Used ONLY for real agent activity (new/changed files in a watched folder),
 * never on a timer or for engagement. Permission is requested once, lazily.
 */

import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

let granted: boolean | null = null;

/** Fire a native notification, requesting permission once. Never throws. */
export async function notifyAgentActivity(title: string, body: string): Promise<void> {
  try {
    if (granted == null) {
      granted =
        (await isPermissionGranted()) || (await requestPermission()) === "granted";
    }
    if (!granted) return;
    sendNotification({ title, body });
  } catch {
    // Notifications unavailable (permission denied, dev/unbundled) — skip.
  }
}
