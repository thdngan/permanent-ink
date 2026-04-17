import { type Editor } from "obsidian";
import type { EditorView } from "@codemirror/view";
import { Notice } from "obsidian";
import { createHighlight, createStrikethrough, applyStrikethroughWithoutPopover } from "./extension";

// --- PUBLIC COMMANDS ---

export function createHighlightCommand(editor: Editor, expandSelection = true) {
	processSelectionAndApplyMark(editor, expandSelection, '==');
	return true;
}

export function createStrikethroughCommand(editor: Editor, expandSelection = true) {
	processSelectionAndApplyMark(editor, expandSelection, '~~');
	return true;
}

// For internal use
export function applyStrikethroughOnSelection(editor: Editor) {
    if (!editor.somethingSelected()) {
        return false;
    }
    // @ts-expect-error, not typed
    const editorView = editor.cm as EditorView;
    return applyStrikethroughWithoutPopover(editorView);
}


// --- CORE LOGIC ---

function processSelectionAndApplyMark(editor: Editor, expandSelection: boolean, tag: '==' | '~~') {
    if (!editor.somethingSelected()) {
        return;
    }

    // @ts-expect-error, not typed
    const editorView = editor.cm as EditorView;

    // --- Step 1: Trim the overall selection's outer whitespace ---
    let from = editor.getCursor("from");
    let to = editor.getCursor("to");

    if (from.line === to.line && expandSelection) {
        expandSelectionBoundary(editor);
        from = editor.getCursor("from");
        to = editor.getCursor("to");
    }

    let selectionText = editor.getRange(from, to);
    const leadingSpaces = (selectionText.match(/^\s*/) as RegExpMatchArray)[0].length;
    const trailingSpaces = (selectionText.match(/\s*$/) as RegExpMatchArray)[0].length;

    if (leadingSpaces > 0) {
        from = editor.offsetToPos(editor.posToOffset(from) + leadingSpaces);
    }
    if (trailingSpaces > 0) {
        to = editor.offsetToPos(editor.posToOffset(to) - trailingSpaces);
    }
    
    selectionText = editor.getRange(from, to);
    if (!selectionText) return;

    // --- Step 2: Check for and handle nested annotations within the trimmed selection ---

    // recognizes an annotation block AND its optional, adjacent comment.
    const annotationRegex = /(?:==.*?==|~~.*?~~)(?:<!--.*?-->)?/g;
    
    const matches = [...selectionText.matchAll(annotationRegex)];

    if (matches.length > 0) {
        new Notice("Selection includes annotations. Applying to valid parts only.");
        
        const rangesToMark = [];
        let lastIndex = 0;

        // a. Find the valid "gaps" between existing annotations
        for (const match of matches) {
            if (match.index! > lastIndex) {
                rangesToMark.push({ start: lastIndex, end: match.index! });
            }
            lastIndex = match.index! + match[0].length;
        }
        if (lastIndex < selectionText.length) {
            rangesToMark.push({ start: lastIndex, end: selectionText.length });
        }

        // b. Apply changes in reverse to avoid messing up character offsets
        const selectionOffset = editor.posToOffset(from);
        for (let i = rangesToMark.length - 1; i >= 0; i--) {
            const range = rangesToMark[i];
            
            const gapStartPos = editor.offsetToPos(selectionOffset + range.start);
            const gapEndPos = editor.offsetToPos(selectionOffset + range.end);
            const gapText = editor.getRange(gapStartPos, gapEndPos);

            // --- Step 3: Trim whitespace for EACH individual gap ---
            const gapLeadingSpaces = (gapText.match(/^\s*/) as RegExpMatchArray)[0].length;
            const gapTrailingSpaces = (gapText.match(/\s*$/) as RegExpMatchArray)[0].length;
            
            const finalStartPos = editor.offsetToPos(editor.posToOffset(gapStartPos) + gapLeadingSpaces);
            const finalEndPos = editor.offsetToPos(editor.posToOffset(gapEndPos) - gapTrailingSpaces);
            const textToWrap = editor.getRange(finalStartPos, finalEndPos);

            if (textToWrap) {
                editor.replaceRange(`${tag}${textToWrap}${tag}`, finalStartPos, finalEndPos);
            }
        }
        
        return;
    }

    // --- Step 4: Normal path (no nested annotations found) ---
    editor.setSelection(from, to);
    editor.blur();
    document.getSelection()?.empty();
    if (tag === '==') {
        createHighlight(editorView);
    } else {
        createStrikethrough(editorView);
    }
}


function expandSelectionBoundary(editor: Editor) {
	const from = editor.getCursor("from");
	const to = editor.getCursor("to");
	const lineFrom = editor.getLine(from.line);
	let start = from.ch;
	let end = to.ch;

	while (start > 0 && lineFrom[start - 1].match(/\w/)) {
		start--;
	}
	while (end < lineFrom.length && lineFrom[end].match(/\w/)) {
		end++;
	}

	editor.setSelection(
		{ line: from.line, ch: start },
		{ line: to.line, ch: end },
	);
}