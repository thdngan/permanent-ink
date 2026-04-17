import { type Editor } from "obsidian";
import type { EditorView } from "@codemirror/view";
import { createHighlight } from "./extension";

export async function createHighlightCommand(
	editor: Editor,
	expandSelection = true,
) {
	if (!editor.somethingSelected()) {
		return false;
	}

	const from = editor.getCursor("from");
	const to = editor.getCursor("to");

	// --- SINGLE-LINE LOGIC ---
	if (from.line === to.line) {
		let selectedText = editor.getSelection();
		if (selectedText.includes("==")) {
			return false;
		}

		if (expandSelection) {
			selectedText = expandSelectionBoundary(editor);
		}

		editor.blur();
		document.getSelection()?.empty();

		// @ts-expect-error, not typed
		const editorView = editor.cm as EditorView;
		createHighlight(editorView);
	}
	// --- MULTI-LINE LOGIC ---
	else {
		// Process from the last line to the first to avoid messing up line numbers
		for (let i = to.line; i >= from.line; i--) {
			const lineContent = editor.getLine(i);

			// Determine the start and end character positions for the selection on this specific line.
			const startCh = i === from.line ? from.ch : 0;
			const endCh = i === to.line ? to.ch : lineContent.length;

			const partSelected = lineContent.substring(startCh, endCh);
			
			// Skip lines that are empty or where the selection is only whitespace
			if (partSelected.trim() === "") {
				continue;
			}
			
			const newText = `==${partSelected}==`;
			editor.replaceRange(newText, { line: i, ch: startCh }, { line: i, ch: endCh });
		}
	}

	return true;
}

function expandSelectionBoundary(editor: Editor) {
	const from = editor.getCursor("from");
	const to = editor.getCursor("to");
	const lineFrom = editor.getLine(from.line);
	const lineTo = editor.getLine(to.line);
	let start = from.ch;
	let end = to.ch;

	// First expand to word boundaries
	while (
		start > 0 &&
		lineFrom[start - 1].match(/\w/) &&
		lineFrom.substring(start - 2, start) !== "=="
	) {
		start--;
	}
	while (
		end < lineTo.length &&
		lineTo[end].match(/\w/) &&
		lineTo.substring(end, end + 2) !== "=="
	) {
		end++;
	}

	// Then shrink from both ends to remove whitespace
	while (start < lineFrom.length && lineFrom[start].match(/\s/)) {
		start++;
	}
	while (end > 0 && lineTo[end - 1].match(/\s/)) {
		end--;
	}

	editor.setSelection(
		{ line: from.line, ch: start },
		{ line: to.line, ch: end },
	);
	return editor.getSelection();
}