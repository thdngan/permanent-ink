import { createRoot, type Root } from "react-dom/client";

// --- GLOBAL POPOVER SETUP ---
// One popover element shared by everything that opens from the editor (annotation comments
// and notes), so only one of them is ever open at a time.
export const unifiedPopoverContainerEl = createDiv();
unifiedPopoverContainerEl.setAttribute("popover", "auto");
unifiedPopoverContainerEl.id = "perink-unified-popover-container";
activeDocument.body.appendChild(unifiedPopoverContainerEl);
export const unifiedPopoverRoot: Root = createRoot(unifiedPopoverContainerEl);

export function cleanup() {
	unifiedPopoverRoot.unmount();
	unifiedPopoverContainerEl.remove();
}
