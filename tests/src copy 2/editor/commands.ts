import { type Editor } from "obsidian";
import type { EditorView } from "@codemirror/view";
import { Notice } from "obsidian";
import { createHighlight, createStrikethrough, applyStrikethroughWithoutPopover } from "./extension";

// --- TYPE HELPERS ---

// Extend the official Editor type to include the 'cm' (CodeMirror) property
// which is present in Live Preview but not in the official type definition.
interface EditorWithCm extends Editor {
	cm: EditorView;
}

// --- PUBLIC COMMANDS ---

export function createHighlightCommand(editor: Editor, expandSelection = true) {
	processSelectionAndApplyMark(editor, expandSelection, '==');
}

export function createStrikethroughCommand(editor: Editor, expandSelection = true) {
	processSelectionAndApplyMark(editor, expandSelection, '~~');
}

export function applyStrikethroughOnSelection(editor: Editor) {
    if (!editor.somethingSelected()) return;
    // Assert the type to access the CodeMirror EditorView instance
    const editorView = (editor as EditorWithCm).cm;
    return applyStrikethroughWithoutPopover(editorView);
}


// --- CORE LOGIC ---

function processSelectionAndApplyMark(editor: Editor, expandSelection: boolean, tag: '==' | '~~') {
    if (!editor.somethingSelected()) return;

    const editorView = (editor as EditorWithCm).cm;
    const from = editor.getCursor("from");
    const to = editor.getCursor("to");
    const isMultiLine = from.line !== to.line;

    // Process lines in reverse to maintain correct offsets during replacement.
    for (let lineNum = to.line; lineNum >= from.line; lineNum--) {
        const lineText = editor.getLine(lineNum);
        
        let startCh = (lineNum === from.line) ? from.ch : 0;
        let endCh = (lineNum === to.line) ? to.ch : lineText.length;

        // If selection on this line is empty (e.g., between two lines), skip.
        if (startCh === endCh && lineText.length > 0) continue;
        
        // --- 1. Expand selection to whole words if enabled ---
        if (expandSelection) {
            // Expand left to the nearest non-word character
            while (startCh > 0 && /\w/.test(lineText[startCh - 1])) {
                startCh--;
            }
            // Expand right to the nearest non-word character
            while (endCh < lineText.length && /\w/.test(lineText[endCh])) {
                endCh++;
            }
        }
        
        // --- 2. Trim whitespace from the (potentially expanded) selection ---
        const selectionOnLine = editor.getRange({ line: lineNum, ch: startCh }, { line: lineNum, ch: endCh });
        const leadingSpaces = selectionOnLine.length - selectionOnLine.trimStart().length;
        const trailingSpaces = selectionOnLine.length - selectionOnLine.trimEnd().length;
        
        const finalStartCh = startCh + leadingSpaces;
        const finalEndCh = endCh - trailingSpaces;
        
        const textToProcess = editor.getRange({ line: lineNum, ch: finalStartCh }, { line: lineNum, ch: finalEndCh });
        if (!textToProcess) continue;
        
        const fromPos = { line: lineNum, ch: finalStartCh };
        const toPos = { line: lineNum, ch: finalEndCh };

        // --- 3. Process for existing annotations ---
        const thingsToIgnoreRegex = /(?:==.*?==|~~.*?~~)(?:<!--.*?-->)?|\$\s*\\quad.*?\$\s?/g;
        const matches = [...textToProcess.matchAll(thingsToIgnoreRegex)];

        if (matches.length === 0) {
            // --- Case A: No existing annotations ---
            if (!isMultiLine) {
                // For single-line selections, we want to show the popover.
                // The create* functions take the current selection, so we set it first.
                editor.setSelection(fromPos, toPos);
                if (tag === '==') createHighlight(editorView);
                else createStrikethrough(editorView);
                // These functions handle the replacement, so we're done.
                return;
            } else {
                // For multi-line, just do the replacement without a popover.
                editor.replaceRange(`${tag}${textToProcess}${tag}`, fromPos, toPos);
            }
        } else {
            // --- Case B: Selection contains existing annotations ---
            if (matches.length === 1 && matches[0][0] === textToProcess) {
                // The entire selection is an ignored block, so do nothing.
                continue;
            }

            new Notice("Selection contains existing annotations. Applying to valid parts only.");
            
            const rangesToMark: { start: number; end: number }[] = [];
            let lastIndex = 0;

            // Find the "gaps" of plain text between the existing annotations
            for (const match of matches) {
                if (match.index! > lastIndex) {
                    rangesToMark.push({ start: lastIndex, end: match.index! });
                }
                lastIndex = match.index! + match[0].length;
            }
            if (lastIndex < textToProcess.length) {
                rangesToMark.push({ start: lastIndex, end: textToProcess.length });
            }

            // Apply changes in reverse order for this line to preserve character offsets
            const lineSelectionOffset = editor.posToOffset(fromPos);
            for (let i = rangesToMark.length - 1; i >= 0; i--) {
                const range = rangesToMark[i];
                
                const textToWrap = textToProcess.substring(range.start, range.end).trim();
                if (!textToWrap) continue;

                // Find where the trimmed text starts within the original "gap"
                const rangeStartOffsetInText = textToProcess.indexOf(textToWrap, range.start);
                
                const finalStartPos = editor.offsetToPos(lineSelectionOffset + rangeStartOffsetInText);
                const finalEndPos = editor.offsetToPos(lineSelectionOffset + rangeStartOffsetInText + textToWrap.length);
                
                editor.replaceRange(`${tag}${textToWrap}${tag}`, finalStartPos, finalEndPos);
            }
        }
    }
}