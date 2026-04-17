import { Plugin, Editor, Notice, MarkdownView, type EditorPosition } from "obsidian";
import { highlightExtension, cleanup as cleanupPopover } from "./editor/extension";
import { OmnidianSettingTab } from "@/settings";
import { createHighlightCommand, createStrikethroughCommand, applyStrikethroughOnSelection } from "@/editor/commands";
import postprocessor from "@/preview/postprocessor";
import "../manifest.json";

export interface OmnidianSettings {
	expandSelection: boolean;
	colors: string[];
}

const DEFAULT_SETTINGS: OmnidianSettings = {
	expandSelection: true,
	colors: ["lightpink", "palegreen", "paleturquoise", "violet"],
};

const FINAL_ANNOTATION_BLOCK_REGEX = /(?:==.*?==|~~.*?~~)(?:<!--.*?-->)?$/;
const DELIMITER_PAIRS = [
	["(", ")"], ["[", "]"], ["{", "}"],
	["'", "'"], ['"', '"'], ["`", "`"],
	["*", "*"], ["**", "**"], ["_", "_"],
	["$", "$"],
];
const QUAD_TO_INSERT = "\\quad";
const INITIAL_QUAD_STRING = `$\\quad\\quad$ `;
const QUAD_START_MARKER = "$\\quad";
const QUAD_END_MARKER = "$ ";



export default class OmnidianPlugin extends Plugin {
	settings: OmnidianSettings = DEFAULT_SETTINGS;
	isHighlightingModeOn = true;
	statusBarItemEl: HTMLElement | null = null;
	private selectionPopup: HTMLElement | null = null;
	private popupKeydownHandler: ((evt: KeyboardEvent) => void) | null = null;

	async onload() {
		await this.loadSettings();

		this.app.workspace.onLayoutReady(() => {
			this.addRibbonIcon("highlighter", "Toggle editing mode", () => this.toggleHighlightingMode());
		});

		this.addStatusBarModeIndicator();
		this.registerEditorExtension([highlightExtension(this.settings.colors)]);

		this.addCommand({
			id: "create-highlight",
			name: "Highlight selection",
			editorCallback: (editor) => createHighlightCommand(editor, this.settings.expandSelection),
		});

		this.addCommand({
			id: "create-strikethrough",
			name: "Strikethrough selection",
			editorCallback: (editor) => createStrikethroughCommand(editor, this.settings.expandSelection),
		});

		this.addCommand({
			id: "toggle-highlighting-mode",
			name: "Toggle editing mode",
			editorCallback: () => this.toggleHighlightingMode(),
		});

		this.addSettingTab(new OmnidianSettingTab(this.app, this));

		this.registerDomEvent(document, "mouseup", this.handleSelectionPopup);
		this.registerDomEvent(document, "mousedown", this.handleDocumentMousedown);
		this.registerDomEvent(document, "touchend", this.handleSelectionPopup);
		this.registerMarkdownPostProcessor(postprocessor);

		this.registerDomEvent(this.app.workspace.containerEl, "keydown", this.handleKeydownInRestrictedMode, true);
	}

	// --- Event Handlers ---

	private handleKeydownInRestrictedMode = (evt: KeyboardEvent): void => {
		if (!this.isHighlightingModeOn) return;

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;
		const editor = view.editor;

		// --- Action-specific handlers ---
		if (evt.key === "Tab") {
			if (this.handleTab(editor)) {
				this.preventEvent(evt);
			}
			const lastLineNum = editor.lastLine();
			const lastLineText = editor.getLine(lastLineNum);
			const endOfDoc = { line: lastLineNum, ch: lastLineText.length };
			editor.setCursor(endOfDoc);
			return; // Always stop after processing Tab
		}
		if (this.isUndoOrCut(evt)) {
			this.preventEvent(evt);
			return;
		}
		if (evt.key === "Enter" && this.isMidDocumentEnter(editor)) {
			this.preventEvent(evt);
			return;
		}
		if (evt.key === "Backspace" || evt.key === "Delete") {
			const handled = (evt.key === "Backspace")
				? this.handleBackspaceInRestrictedMode(editor)
				: this.handleDeleteInRestrictedMode(editor);
			if (handled) this.preventEvent(evt);
			return;
		}
		
		const isTyping = this.isTypingKey(evt);
		if(isTyping && this.handleTyping(editor, evt.key)) {
			this.preventEvent(evt);
		}
	}

	private handleDocumentMousedown = (evt: MouseEvent) => {
		if (this.selectionPopup && !this.selectionPopup.contains(evt.target as Node)) {
			this.removeSelectionPopup();
		}
	};

	private handleSelectionPopup = (evt: MouseEvent | TouchEvent) => {
		// Ignore clicks inside popups
		if (evt.target instanceof Element && evt.target.closest('#perink-selection-popup, #perink-comment-popover-container')) {
			return;
		}
		// Ignore right-clicks
		if (evt instanceof MouseEvent && evt.button !== 0) return;

		const editor = this.app.workspace.activeEditor?.editor;
		if (!editor) {
			this.removeSelectionPopup();
			return;
		}

		// Use a small timeout to allow the selection to be properly registered
		setTimeout(() => {
			if (editor.getSelection()) {
				this.createSelectionPopup(editor);
			} else {
				this.removeSelectionPopup();
			}
		}, 10);
	};


	// --- Restricted Mode: Key Press Logic ---

	private isUndoOrCut(evt: KeyboardEvent): boolean {
		const isModifier = evt.ctrlKey || evt.metaKey;
		const key = evt.key.toLowerCase();
		return isModifier && !evt.shiftKey && (key === "z" || key === "x");
	}

	private isMidDocumentEnter(editor: Editor): boolean {
		const cursor = editor.getCursor();
		const lastLineNum = editor.lastLine();
		const lastLineText = editor.getLine(lastLineNum);
		const textAfterCursor = editor.getRange(cursor, { line: editor.lastLine(), ch: Infinity });
		const charAfterCursor = editor.getRange(cursor, { line: cursor.line, ch: cursor.ch + 1 });

		// If no non-whitespace text after cursor and character right after is whitespace/empty/newline
		const onlyWhitespace = (!/\S/.test(textAfterCursor) && (/\s/.test(charAfterCursor) || !charAfterCursor || charAfterCursor === "\n"))
		return !editor.somethingSelected() && (editor.getCursor().line < editor.lastLine() && !onlyWhitespace) || (cursor.line ===lastLineNum && cursor.ch < lastLineText.length);
	}
	
	private isTypingKey(evt: KeyboardEvent): boolean {
		return evt.key.length === 1 && !evt.ctrlKey && !evt.metaKey && !evt.altKey;
	}

	private handleTab(editor: Editor): boolean {
		const cursor = editor.getCursor();
		const lineNum = cursor.line;
		const lineText = editor.getLine(lineNum);
		const lastLineNum = editor.lastLine();
		const quadRange = this.findQuadBlockRange(lineText);
		let textBeforeCursor: string;
		let emptyLine: string;
		if (quadRange) {
			emptyLine = `0`;
			// Not an empty line (has quad indentation), then ignore quad strings when
			// checking for text before cursor.
			textBeforeCursor = editor.getRange({ line: lineNum, ch: quadRange.end },cursor);
		} else {
			emptyLine = `1`;
			// An empty line (no quad indentation)
			textBeforeCursor = editor.getRange({ line: lineNum, ch: 0 },cursor);
		}
		
		if (!/\S/.test(textBeforeCursor)) { // if only whitespace before cursor
		if (emptyLine === `1` && lineNum !== lastLineNum) {
			// If it's an empty line in the middle of the document, put cursor to end of document.
			editor.setCursor({ line: lastLineNum, ch: editor.getLine(lastLineNum).length });
			return true;
		}
		// Case 2: The line already has quad indentation. Add more.
		else if (lineText.trim().startsWith(QUAD_START_MARKER)) {
			// Find position of the last "$ " to insert before it.
			const endMarkerIndex = lineText.lastIndexOf(QUAD_END_MARKER);
			if (endMarkerIndex !== -1) {
				const insertPos = { line: lineNum, ch: endMarkerIndex };
				editor.replaceRange(QUAD_TO_INSERT, insertPos);
				editor.setCursor({ line: lineNum, ch: endMarkerIndex + QUAD_TO_INSERT.length });
				return true;
			}
		} 
		// Case 1: The line is last and does not have quad indentation yet.
		else if (lineNum === lastLineNum) {
				const textAfterCursor = editor.getRange(cursor, { line: lineNum, ch: lineText.length });
				if (!/\S/.test(textAfterCursor)){ // Add indentation
					const insertPos = { line: lineNum, ch: 0 };
					editor.replaceRange(INITIAL_QUAD_STRING, insertPos);
					editor.setCursor({ line: lineNum, ch: INITIAL_QUAD_STRING.length });
					return true; // Event handled
				} else { // if there's already text in the last line, put cursor to end of line.
					editor.setCursor({ line: lastLineNum, ch: editor.getLine(lastLineNum).length });
					return true;
				}
		}
		}
		else { // if there are characters before cursor, do nothing.
			return true;
		}
	
		return false; // Should not be reached, but as a fallback
	}

	// private handleTyping(editor: Editor, key: string): boolean {
	// 	const cursor = editor.getCursor();
	// 	const line = editor.getLine(cursor.line);
	// 	const lastLineNum = editor.lastLine();
	// 	const lastLineText = editor.getLine(lastLineNum);

	// 	// Auto-spacing after a final annotation block
	// 	if (/\S/.test(key) && cursor.line === lastLineNum && cursor.ch === lastLineText.length && FINAL_ANNOTATION_BLOCK_REGEX.test(lastLineText)) {
	// 		editor.replaceSelection(" ");
	// 	}
		
	// 	// If anything is selected, or if typing in the middle of a line, move to the end.
	// 	// After moving the cursor, we allow the default typing action to occur,
	// 	// unless we are trying to type right before a closing character at the very end of a line.
	// 	if(editor.somethingSelected() || cursor.ch < editor.getLine(cursor.line).length) {
	// 		// --- EXCEPTION LOGIC ---
	// 		// We check for a very specific case: is the cursor right before a 
	// 		// closing character that is ALSO the very last character on the line?
	// 		// This allows typing inside newly created auto-pairs, like `(|)`.
	// 		const charAfter = line.charAt(cursor.ch);
	// 		if (cursor.line === lastLineNum && cursor.ch === line.length -1 && CLOSING_CHARS.includes(charAfter)) {
	// 			editor.replaceSelection(key); // Manually insert and prevent default
	// 			return true;
	// 		}
	// 		// Let the event proceed at the new cursor position
	// 		const endOfDoc = { line: lastLineNum, ch: lastLineText.length };
	// 		editor.setCursor(endOfDoc);
	// 	}

	// 	return false; // Do not prevent default for normal typing at the end
	// }

    /**
     * Handles all typing events in restricted mode.
     * @returns `true` if the event was handled and default action should be prevented.
     */
	private handleTyping(editor: Editor, key: string): boolean {
		const cursor = editor.getCursor();
		const lastLineNum = editor.lastLine();
		const lastLineText = editor.getLine(lastLineNum);
		const endOfDoc = { line: lastLineNum, ch: lastLineText.length };
	
		// --- Priority 2: Handling typing when not at the absolute end of a line. ---
		const isMidTyping = editor.somethingSelected() || cursor.ch < editor.getLine(cursor.line).length;
	
		if (isMidTyping) {
			// Priority 2: Check for the special case: typing inside a delimiter pair that is at the very end of the document.
			const pairResult = this.findEnclosingPairAtDocEnd(editor, cursor);
	
			if (pairResult.isMatch && pairResult.jumpTarget) {
				// We are inside a bracket pair at the very end of the doc.
				// Move cursor to right before the closing bracket.
				editor.setCursor(pairResult.jumpTarget);
				// Let the native typing happen at the new cursor position.
				return false;
			} else {
				// We are typing mid-line but NOT inside a recognized pair.
				// Move the cursor to the end of the document.
				editor.setCursor(endOfDoc);

				if (/\S/.test(key) && FINAL_ANNOTATION_BLOCK_REGEX.test(lastLineText)) {
					// If so, insert a space AND the typed key, then stop all other processing.
					editor.replaceSelection(" " + key);
					return true; // Event handled, prevent default.
				}

				// Let the default event proceed at the new cursor position.
				return false;
			}
		} else {
			// Move the cursor to the end of the document.
			editor.setCursor(endOfDoc);

			// --- Priority 1: Auto-spacing after a final annotation block. ---
			// This checks if we are trying to type a non-whitespace character at the exact end of the document,
			// and if the document ends with one of our annotation blocks.
			if (/\S/.test(key) && cursor.line === lastLineNum && cursor.ch === lastLineText.length && FINAL_ANNOTATION_BLOCK_REGEX.test(lastLineText)) {
				// If so, insert a space AND the typed key, then stop all other processing.
				editor.replaceSelection(" " + key);
				return true; // Event handled, prevent default.
			}

			// Let the default event proceed at the new cursor position.
			return false;
		}
	
		// --- Default Behavior ---
		// If none of the above special conditions are met (e.g., normal typing at the very end of the doc),
		// do not interfere.
		return false;
	}

	private handleBackspaceInRestrictedMode(editor: Editor): boolean {
		if (editor.somethingSelected()) {
			createStrikethroughCommand(editor, this.settings.expandSelection);
			editor.setCursor(editor.getCursor('to'));
			return true;
		}

		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);

		const quadRange = this.findQuadBlockRange(line);
		if (quadRange && cursor.ch > quadRange.start && cursor.ch <= quadRange.end) {
			// If cursor is inside or right after the quad block, delete the whole block.
			editor.replaceRange("", { line: cursor.line, ch: quadRange.start }, { line: cursor.line, ch: quadRange.end });
			return true;
		}

		const textAfterCursor = editor.getRange(cursor, { line: editor.lastLine(), ch: Infinity });
		const charBeforeCursor = editor.getRange({ line: cursor.line, ch: cursor.ch - 1 }, cursor);

		// If there is no content after the cursor and the character before is whitespace/newline/empty, allow deletion.
		if (!/\S/.test(textAfterCursor)) {
			if (/\s/.test(charBeforeCursor) || !charBeforeCursor || charBeforeCursor === "\n") {
				return false;
			}
		}

		// --- Smart Quad Block Handling (Skip vs. Delete) ---
		const quadRangeAtCursor = this.findQuadBlockAtCursor(line, cursor.ch);
		if (quadRangeAtCursor) {
			// A quad block exists, and the cursor is inside it.
			const quadContent = line.substring(quadRangeAtCursor.start, quadRangeAtCursor.end);
			const isLineOnlyIndent = line.trim() === quadContent.trim();
	
			if (!isLineOnlyIndent) {
				// There's other text on the line. Skip to the end of previous line.
				if (cursor.line !== 0) { // if this is not the very first line
					editor.setCursor({ line: cursor.line - 1, ch: editor.getLine(cursor.line-1).length });
				} else { // if at very first line, then just put cursor right after quad block
					editor.setCursor({ line: cursor.line, ch: quadRangeAtCursor.end })
				}
			}
			return true;
		}



		// If over whitespace, just move cursor back
		if (/\s/.test(charBeforeCursor)) {
			editor.setCursor({ line: cursor.line, ch: cursor.ch - 1 });
			return true;
		}

		// If inside an annotation, jump to its start
		const annotationBlock = this.findAnnotationBlockAtCursor(editor, cursor);
		if (annotationBlock) {
			editor.setCursor(annotationBlock.start);
			return true;
		}
		
		// Otherwise, strikethrough the word to the left
		const wordRange = this.expandToWordAtCursor(editor, cursor);
		if (wordRange) {
			editor.setSelection(wordRange.from, wordRange.to);
			applyStrikethroughOnSelection(editor);
			editor.setCursor(wordRange.from);
			return true;
		}
		
		// Fallback: just move cursor back one char
		editor.setCursor({ line: cursor.line, ch: cursor.ch - 1 });
		return true;
	}
	
	private handleDeleteInRestrictedMode(editor: Editor): boolean {
		if (editor.somethingSelected()) {
			createStrikethroughCommand(editor, this.settings.expandSelection);
			editor.setCursor(editor.getCursor('to'));
			return true;
		}
		
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);

		// Check for and handle quad block deletion first (for quad indentation-only lines).
		const quadRange = this.findQuadBlockRange(line);

		if (quadRange && cursor.ch >= quadRange.start && cursor.ch < quadRange.end) {
			// If cursor is at the start or inside the quad block, delete the whole block.
			editor.replaceRange("", { line: cursor.line, ch: quadRange.start }, { line: cursor.line, ch: quadRange.end });
			return true;
		}

		const textAfterCursor = editor.getRange(cursor, { line: editor.lastLine(), ch: Infinity });
		const charAfterCursor = editor.getRange(cursor, { line: cursor.line, ch: cursor.ch + 1 });
		
		// If no non-whitespace text after cursor and character right after is whitespace/empty/newline, allow deletion
		if (!/\S/.test(textAfterCursor) && (/\s/.test(charAfterCursor) || !charAfterCursor || charAfterCursor === "\n")) return false;
		
		// --- Smart Quad Block Handling (Skip vs. Delete) ---
		const quadRangeAtCursor = this.findQuadBlockAtCursor(line, cursor.ch);
		if (quadRangeAtCursor) {
			// A quad block exists, and the cursor is inside it.
			const quadContent = line.substring(quadRangeAtCursor.start, quadRangeAtCursor.end);
			const isLineOnlyIndent = line.trim() === quadContent.trim();
	
			if (!isLineOnlyIndent) {
				if (cursor.ch < quadRangeAtCursor.end) {
					// Cursor is inside the quad block, so move to end
					editor.setCursor({ line: cursor.line, ch: quadRangeAtCursor.end });
					return true;
				}
				// Cursor is already at the end, let logic continue to next cases
			} else {
				// If the line is just a quad block, delete it
				editor.replaceRange("", { line: cursor.line, ch: quadRangeAtCursor.start }, { line: cursor.line, ch: quadRangeAtCursor.end });
				return true;
			}
			// return true;
		}

		// If over whitespace, just move cursor forward
		if (/\s/.test(charAfterCursor)) {
			editor.setCursor({ line: cursor.line, ch: cursor.ch + 1 });
			return true;
		}
		
		// If inside annotation, jump to its end
		const annotationBlock = this.findAnnotationBlockAtCursor(editor, cursor);
		if (annotationBlock) {
			editor.setCursor(annotationBlock.end);
			return true;
		}
		
		// Otherwise, strikethrough the word to the right
		const wordRange = this.expandToWordAtCursor(editor, cursor);
		if (wordRange) {
			const originalLength = wordRange.to.ch - wordRange.from.ch;
			editor.setSelection(wordRange.from, wordRange.to);
			applyStrikethroughOnSelection(editor);
			// Place cursor after the newly created strikethrough markup (`~~word~~`)
			editor.setCursor({ line: wordRange.from.line, ch: wordRange.from.ch + originalLength + 4 });
			return true;
		}
		
		// Fallback: just move cursor forward one char
		editor.setCursor({ line: cursor.line, ch: cursor.ch + 1 });
		return true;
	}


	// --- Popups ---

	private createSelectionPopup(editor: Editor) {
		this.removeSelectionPopup(); // Ensure no duplicates

		const popup = document.createElement("div");
		popup.id = "perink-selection-popup";

		const createButton = (text: string, onClick: (e: MouseEvent) => void) => {
			const button = popup.createEl("button", { text });
			button.addEventListener("click", (e) => {
				e.stopPropagation();
				onClick(e);
				this.removeSelectionPopup();
				editor.focus();
				editor.setCursor(editor.getCursor('to'));
			});
			return button;
		};

		createButton("Cross out (Backspace/Delete)", () => createStrikethroughCommand(editor, this.settings.expandSelection));
		createButton("Highlight (H)", () => createHighlightCommand(editor, this.settings.expandSelection));

		document.body.appendChild(popup);
		this.selectionPopup = popup;

		// --- Keyboard shortcuts for the popup ---
		this.popupKeydownHandler = (evt: KeyboardEvent) => {
			const key = evt.key.toLowerCase();
			let command: ((editor: Editor, expand: boolean) => void) | null = null;
			
			if (key === 'h') command = createHighlightCommand;
			else if (key === 'backspace' || key === 'delete') command = createStrikethroughCommand;
			
			if (command) {
				this.preventEvent(evt);
				command(editor, this.settings.expandSelection);
				this.removeSelectionPopup();
				editor.focus();
				editor.setCursor(editor.getCursor('to'));
			} else {
				// Any other key dismisses the popup
				this.removeSelectionPopup();
			}
		};
		document.addEventListener('keydown', this.popupKeydownHandler, true);

		// --- Positioning ---
		const selection = window.getSelection()?.getRangeAt(0).getBoundingClientRect();
		if (!selection) return;

		let top = selection.top - popup.offsetHeight - 5;
		let left = selection.left + (selection.width / 2) - (popup.offsetWidth / 2);

		// Adjust if off-screen
		if (top < 5) top = selection.bottom + 5;
		if (left < 5) left = 5;

		popup.style.top = `${top}px`;
		popup.style.left = `${left}px`;
	}

	private removeSelectionPopup() {
		if (this.popupKeydownHandler) {
			document.removeEventListener('keydown', this.popupKeydownHandler, true);
			this.popupKeydownHandler = null;
		}
		this.selectionPopup?.remove();
		this.selectionPopup = null;
	}


	// --- Helper Methods ---

	private preventEvent(evt: Event) {
		evt.preventDefault();
		evt.stopPropagation();
	}
	
	private findAnnotationBlockAtCursor(editor: Editor, cursor: EditorPosition): { start: EditorPosition, end: EditorPosition } | null {
		const lineText = editor.getLine(cursor.line);
		const annotationRegex = /(?:==.*?==|~~.*?~~)(?:<!--.*?-->)?/g;
		let match;
		while ((match = annotationRegex.exec(lineText)) !== null) {
			const startCh = match.index;
			const endCh = match.index + match[0].length;
			if (cursor.ch >= startCh && cursor.ch <= endCh) {
				return { 
					start: { line: cursor.line, ch: startCh },
					end: { line: cursor.line, ch: endCh } 
				};
			}
		}
		return null;
	}

	/**
	 * Checks if the cursor is inside a delimiter pair where the closing delimiter
	 * is followed by nothing but whitespace until the end of the document.
	 * @returns An object indicating if a match was found and the target position to jump the cursor to.
	 */
	private findEnclosingPairAtDocEnd(editor: Editor, cursor: EditorPosition): { isMatch: boolean; jumpTarget?: EditorPosition } {
		const lastLineNum = editor.lastLine();
		// This logic only applies if the cursor is on the last line of the document.
		if (cursor.line !== lastLineNum) {
			return { isMatch: false };
		}
	
		const line = editor.getLine(lastLineNum);
		for (const [open, close] of DELIMITER_PAIRS) {
			const lastOpenIndex = line.lastIndexOf(open, cursor.ch - open.length);
			if (lastOpenIndex === -1) continue;
	
			const nextCloseIndex = line.indexOf(close, lastOpenIndex + open.length);
	
			// Condition 1: Is the cursor inside this pair?
			if (nextCloseIndex !== -1 && cursor.ch <= nextCloseIndex) {
				// Condition 2: Is everything AFTER the closing delimiter just whitespace?
				const trailingText = line.substring(nextCloseIndex + close.length);
				if (trailingText.trim() === '') {
					// Match found! The target is the position *right before* the closing delimiter.
					return {
						isMatch: true,
						jumpTarget: { line: lastLineNum, ch: nextCloseIndex }
					};
				}
			}
		}
	
		return { isMatch: false };
	}

	/**
	 * Finds any quad block at the cursor's position, anywhere on the line.
	 * Used for smart backspace (skip vs. delete).
	 * @param lineText The text of the line to search.
	 * @param cursorCh The character position of the cursor on the line.
	 */
	private findQuadBlockAtCursor(lineText: string, cursorCh: number): { start: number; end: number } | null {
		const quadRegex = /\$\s*\\quad.*?\$ /g;
		let match;
		while ((match = quadRegex.exec(lineText)) !== null) {
			const start = match.index;
			const end = start + match[0].length;
			if (cursorCh >= start && cursorCh <= end) {
				return { start, end };
			}
		}
		return null;
	}

	/**
	 * Finds a quad block that functions as the sole indentation of a line.
	 * Used for deleting indentation with the Delete key.
	 */
	private findQuadBlockRange(lineText: string): { start: number; end: number } | null {
		const trimmedStart = lineText.trimStart();
		if (!trimmedStart.startsWith(QUAD_START_MARKER)) {
			return null;
		}
	
		// Find the last occurrence of the end marker within the content.
		const endMarkerIndex = trimmedStart.lastIndexOf(QUAD_END_MARKER);
		if (endMarkerIndex === -1 || endMarkerIndex === 0) { // must be after the start
			return null;
		}
	
		// Calculate the end position of the block *within the trimmed-start string*.
		// This is the position *after* the trailing space of the end marker.
		const blockEndInTrimmed = endMarkerIndex + QUAD_END_MARKER.length;
	
		// Check if anything *after* this block in the line is non-whitespace.
		// If so, it's not a valid indentation-only block.
		const trailingText = trimmedStart.substring(blockEndInTrimmed);
		if (trailingText.trim() !== '') {
			return null;
		}
	
		// It's a valid block. Calculate the final range relative to the original, untrimmed line.
		const startOffset = lineText.length - trimmedStart.length;
		const start = startOffset;
		const end = startOffset + blockEndInTrimmed;
	
		return { start, end };
	}

	private expandToWordAtCursor(editor: Editor, cursor: EditorPosition): { from: EditorPosition; to: EditorPosition } | null {
		const line = editor.getLine(cursor.line);
		if (!line) return null;
		
		const isWordChar = (char: string) => char && /\w/.test(char);
		
		// Ensure cursor is adjacent to or within a word
		if (!isWordChar(line[cursor.ch]) && !isWordChar(line[cursor.ch - 1])) {
			return null;
		}

		let start = cursor.ch;
		let end = cursor.ch;

		// Expand left
		while (start > 0 && isWordChar(line[start - 1])) start--;
		// Expand right
		while (end < line.length && isWordChar(line[end])) end++;
		
		if (start === end) return null;
		
		return {
			from: { line: cursor.line, ch: start },
			to: { line: cursor.line, ch: end },
		};
	}


	// --- Plugin State & UI ---

	toggleHighlightingMode() {
		this.isHighlightingModeOn = !this.isHighlightingModeOn;
		this.updateStatusBar();
		new Notice(`Permanent Ink ${this.isHighlightingModeOn ? "enabled" : "disabled"}`);
	}

	addStatusBarModeIndicator() {
		this.statusBarItemEl = this.addStatusBarItem();
		this.updateStatusBar();
		this.statusBarItemEl.addEventListener("click", () => this.toggleHighlightingMode());
	}

	private updateStatusBar(): void {
		if (!this.statusBarItemEl) return;
		if (this.isHighlightingModeOn) {
			this.statusBarItemEl.setText("Permanent Ink: ON");
			this.statusBarItemEl.className = "status-bar-item is-active";
			this.statusBarItemEl.setAttribute("title", "Editing is restricted. Click to disable.");
		} else {
			this.statusBarItemEl.setText("Permanent Ink: OFF");
			this.statusBarItemEl.className = "status-bar-item is-inactive";
			this.statusBarItemEl.setAttribute("title", "Normal editing is allowed. Click to enable.");
		}
	}

	onunload() {
		cleanupPopover();
		this.statusBarItemEl?.remove();
		this.removeSelectionPopup();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}