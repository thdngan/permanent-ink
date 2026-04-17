import { Plugin, Editor, Notice, MarkdownView, type EditorPosition, debounce } from "obsidian";
import { highlightExtension, cleanup } from "./editor/extension";
import { OmnidianSettingTab } from "@/settings";
import { createHighlightCommand, createStrikethroughCommand, applyStrikethroughOnSelection } from "@/editor/commands";
import postprocessor from "@/preview/postprocessor";
import { OmnidianAnnotationsView, OMNIDIAN_ANNOTATIONS_VIEW_TYPE, type Annotation } from "./view";
import { matchColor } from "./lib/utils";
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
	["$", "$"], ["[[", "]]"]
];
const QUAD_TO_INSERT = "\\quad";
const INITIAL_QUAD_STRING = `$\\quad$ `;
const QUAD_START_MARKER = "$\\quad";
const QUAD_END_MARKER = "$ ";



export default class OmnidianPlugin extends Plugin {
	settings: OmnidianSettings = DEFAULT_SETTINGS;
	isHighlightingModeOn = true;
	statusBarItemEl: HTMLElement | null = null;
	private selectionPopup: HTMLElement | null = null;
	private debouncedUpdate!: () => void;
	private popupKeydownHandler: ((evt: KeyboardEvent) => void) | null = null;

	async onload() {
		// --- To inject the SVG filter on load ---
		this.injectGooeyFilter();

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
		
		// --- View Registration & Event Handling ---
		this.registerView(OMNIDIAN_ANNOTATIONS_VIEW_TYPE, (leaf) => new OmnidianAnnotationsView(leaf));

		this.addRibbonIcon("message-square-quote", "Show annotations", () => {
			this.activateView();
		});

		// Debounce the update function to avoid performance issues
		this.debouncedUpdate = debounce(() => this.updateAnnotationsView(), 300, true);

		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.debouncedUpdate()));
		this.registerEvent(this.app.workspace.on("editor-change", () => this.debouncedUpdate()));
	}

	/**
	 * Injects an invisible SVG element into the body, containing the filter
	 * needed for the "gooey" blob effect in the color palette.
	 */
	private injectGooeyFilter() {
		if (document.getElementById("perink-gooey-filter")) return;

		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.id = "perink-gooey-filter";
		svg.style.display = "none";
		svg.setAttribute("version", "1.1");

		const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
		const filter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
		filter.id = "goo";

		const feGaussianBlur = document.createElementNS("http://www.w3.org/2000/svg", "feGaussianBlur");
		feGaussianBlur.setAttribute("in", "SourceGraphic");
		feGaussianBlur.setAttribute("stdDeviation", "10");
		feGaussianBlur.setAttribute("result", "blur");

		const feColorMatrix = document.createElementNS("http://www.w3.org/2000/svg", "feColorMatrix");
		feColorMatrix.setAttribute("in", "blur");
		feColorMatrix.setAttribute("mode", "matrix");
		feColorMatrix.setAttribute("values", "1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7");
		feColorMatrix.setAttribute("result", "goo");

		const feBlend = document.createElementNS("http://www.w3.org/2000/svg", "feBlend");
		feBlend.setAttribute("in", "SourceGraphic");
		feBlend.setAttribute("in2", "goo");

		filter.append(feGaussianBlur, feColorMatrix, feBlend);
		defs.appendChild(filter);
		svg.appendChild(defs);

		document.body.appendChild(svg);
	}


	// --- Event Handlers ---

	private handleKeydownInRestrictedMode = (evt: KeyboardEvent): void => {
		if (!this.isHighlightingModeOn) return;

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;
		const editor = view.editor;

		// --- Arrow Key Navigation ---
		if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(evt.key)) {
			let handled = false;

			switch (evt.key) {
				case "ArrowLeft":
					handled = this.handleArrowLeft(editor);
					break;
				case "ArrowRight":
					handled = this.handleArrowRight(editor);
					break;
				case "ArrowUp":
					handled = this.handleArrowUp(editor);
					break;
				case "ArrowDown":
					handled = this.handleArrowDown(editor);
					break;
			}

			if (handled) {
				this.preventEvent(evt);
				return;
			}
		}


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
		if (evt.target instanceof Element && evt.target.closest('#perink-selection-popup, #perink-comment-popover-container, #perink-color-palette-popover-container')) {
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

	private handleArrowLeft(editor: Editor): boolean {
		const cursor = editor.getCursor();
	
		// --- 1. Handle Annotation Blocks ---
		const annotationBlock = this.findAnnotationBlockAtCursor(editor, cursor);
		if (annotationBlock) {
			// If cursor is not at the very start of the annotation, jump to the start.
			if (cursor.ch > annotationBlock.start.ch || cursor.line > annotationBlock.start.line) {
				editor.setCursor(annotationBlock.start);
				return true;
			}
			// If at the start of an annotation, we fall through to check for a quad block
			// immediately to the left, instead of prematurely returning false.
		}
		
		// --- 2. Handle Quad Blocks ---
		const lineText = editor.getLine(cursor.line);
		const quadRangeAtCursor = this.findQuadBlockAtCursor(lineText, cursor.ch);
		if (quadRangeAtCursor) {
			// There's other text on the line. Skip to the end of previous line.
			if (cursor.line !== 0) { // if this is not the very first line
				// Jump to the end of the previous line.
				editor.setCursor({ line: cursor.line - 1, ch: editor.getLine(cursor.line-1).length });
			} else { // if at very first line, then just put cursor right after quad block
				editor.setCursor({ line: cursor.line, ch: quadRangeAtCursor.end });
			}
			return true;
		}
	
		return false;
	}
	
	private handleArrowRight(editor: Editor): boolean {
		const cursor = editor.getCursor();
	
		// --- 1. Handle being *inside* an Annotation Block ---
		const annotationBlock = this.findAnnotationBlockAtCursor(editor, cursor);
		if (annotationBlock) {
			if (cursor.ch < annotationBlock.end.ch || cursor.line < annotationBlock.end.line) {
				editor.setCursor(annotationBlock.end);
				return true;
			}
		}
	
		// --- 2. Handle being *inside* a Quad Block ---
		const currentLineText = editor.getLine(cursor.line);
		const quadRangeAtCursor = this.findQuadBlockAtCursor(currentLineText, cursor.ch);
		if (quadRangeAtCursor) {
			if (cursor.ch < quadRangeAtCursor.end) {
				editor.setCursor({ line: cursor.line, ch: quadRangeAtCursor.end });
				return true;
			}
		}
	
		// --- 3. Lookahead logic for end-of-line -> start-of-quad ---
		const isAtEndOfLine = cursor.ch === currentLineText.length;
		const isNotLastLine = cursor.line < editor.lastLine();
	
		if (isAtEndOfLine && isNotLastLine) {
			const nextLineText = editor.getLine(cursor.line + 1);
			const nextLineQuadRange = this.findStartingQuadBlockRange(nextLineText);
	
			if (nextLineQuadRange) {
				// The next line starts with a quad block. Jump to its end.
				editor.setCursor({ line: cursor.line + 1, ch: nextLineQuadRange.end });
				return true;
			}
		}
	
		return false;
	}

	private handleArrowDown(editor: Editor): boolean {
		const cursor = editor.getCursor();
		const nextLineText = editor.getLine(cursor.line + 1);
		const nextLineQuadRange = this.findQuadBlockAtCursor(nextLineText, cursor.ch);

		if (nextLineQuadRange) {
			// The next line inside a quad block. Jump to its end.
			editor.setCursor({ line: cursor.line + 1, ch: nextLineQuadRange.end });
			return true;
		}
	
		return false;
	}

	private handleArrowUp(editor: Editor): boolean {
		const cursor = editor.getCursor();
		
		// --- Look behind logic ---
		const nextLineText = editor.getLine(cursor.line - 1);
		const nextLineQuadRange = this.findQuadBlockAtCursor(nextLineText, cursor.ch);

		if (nextLineQuadRange) {
			// The next line inside a quad block. Jump to its end.
			editor.setCursor({ line: cursor.line - 1, ch: nextLineQuadRange.end });
			return true;
		}

		return false;
	}

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
		// If there's a selection, the primary action is to strikethrough it.
		if (editor.somethingSelected()) {
			createStrikethroughCommand(editor, this.settings.expandSelection);
			editor.setCursor(editor.getCursor('to')); // Move cursor to the end of the selection
			return true;
		}
	
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
	
		// Handle quad indentation deletion.
		const quadRange = this.findQuadBlockRange(line);
		if (quadRange && cursor.ch > quadRange.start && cursor.ch <= quadRange.end) {
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
	
		// Smartly jump out of quad blocks if there's other text on the line.
		const quadRangeAtCursor = this.findQuadBlockAtCursor(line, cursor.ch);
		if (quadRangeAtCursor) {
			// A quad block exists, and the cursor is inside it.
			const quadContent = line.substring(quadRangeAtCursor.start, quadRangeAtCursor.end);
			const isLineOnlyIndent = line.trim() === quadContent.trim();
			if (!isLineOnlyIndent) {
				// There's other text on the line. Skip to the end of previous line.
				if (cursor.line !== 0) { // if this is not the very first line
					// Jump to the end of the previous line.
					editor.setCursor({ line: cursor.line - 1, ch: editor.getLine(cursor.line-1).length });
				} else { // if at very first line, then just put cursor right after quad block
					editor.setCursor({ line: cursor.line, ch: quadRangeAtCursor.end });
				}
			}
			return true;
		}



		// If over whitespace, just move cursor back
		if (/\s/.test(charBeforeCursor)) {
			editor.setCursor({ line: cursor.line, ch: cursor.ch - 1 });
			return true;
		}

		// If inside an annotation, jump to its start.
		const annotationBlock = this.findAnnotationBlockAtCursor(editor, cursor);
		if (annotationBlock) {
			editor.setCursor(annotationBlock.start);
			return true;
		}
	
		// The main restricted mode action: strikethrough the word to the left.
		const wordRange = this.expandToWordAtCursor(editor, cursor);
		if (wordRange) {
			editor.setSelection(wordRange.from, wordRange.to);
			applyStrikethroughOnSelection(editor);
			editor.setCursor(wordRange.from); // Move cursor to the start of the new strikethrough.
			return true;
		}
	
		// Fallback for any other case (e.g., cursor is after a non-word, non-whitespace character like '!').
		// Move the cursor back one space and prevent the default deletion.
		if (cursor.ch > 0) {
			editor.setCursor({ line: cursor.line, ch: cursor.ch - 1 });
		}
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

		// --- Make the popup draggable ---
		let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
		popup.onmousedown = dragMouseDown;

		function dragMouseDown(e: MouseEvent) {
			e.preventDefault();
			// get the mouse cursor position at startup:
			pos3 = e.clientX;
			pos4 = e.clientY;
			document.onmouseup = closeDragElement;
			// call a function whenever the cursor moves:
			document.onmousemove = elementDrag;
		}

		function elementDrag(e: MouseEvent) {
			e.preventDefault();
			// calculate the new cursor position:
			pos1 = pos3 - e.clientX;
			pos2 = pos4 - e.clientY;
			pos3 = e.clientX;
			pos4 = e.clientY;
			// set the element's new position:
			popup.style.top = (popup.offsetTop - pos2) + "px";
			popup.style.left = (popup.offsetLeft - pos1) + "px";
		}

		function closeDragElement() {
			// stop moving when mouse button is released:
			document.onmouseup = null;
			document.onmousemove = null;
		}
		// --- End Draggable Logic ---

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
			// If restricted mode is ON, handle special shortcuts
			if (this.isHighlightingModeOn) {
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
			} else {
				// If restricted mode is OFF, pressing any key should just dismiss the popup
				// and allow the default browser action to proceed.
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

	/**
	 * Finds a quad block at the beginning of a line, allowing other text to follow.
	 * Used for the arrow-right "lookahead" navigation.
	 */
	private findStartingQuadBlockRange(lineText: string): { start: number; end: number } | null {
		const trimmedStart = lineText.trimStart();
		// Regex to find '$ \quad... $ ' pattern at the very start of the trimmed string
		const quadBlockRegex = /^\$\s*(?:\\quad\s*)+\$\s/;
		const match = trimmedStart.match(quadBlockRegex);

		if (match) {
			const blockText = match[0]; // The full matched indentation string, e.g., "$\quad$ "
			const startOffset = lineText.length - trimmedStart.length; // The length of any initial whitespace
			const start = startOffset;
			const end = startOffset + blockText.length;
			return { start, end };
		}

		return null;
	}

	private expandToWordAtCursor(editor: Editor, cursor: EditorPosition): { from: EditorPosition; to: EditorPosition } | null {
		const line = editor.getLine(cursor.line);
		if (!line) return null;
		
		const isWordChar = (char: string) => char && /[\p{L}\p{N}_]/u.test(char); ///\w/.test(char);
		
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


	// --- Annotation View Logic ---

	/**
	 * Opens the annotations view in the right sidebar.
	 */
	async activateView() {
		this.app.workspace.detachLeavesOfType(OMNIDIAN_ANNOTATIONS_VIEW_TYPE);

		const leaf = this.app.workspace.getRightLeaf(true);
		if (leaf) { 
			await leaf.setViewState({
				type: OMNIDIAN_ANNOTATIONS_VIEW_TYPE,
				active: true,
			});

			this.app.workspace.revealLeaf(leaf);
			this.updateAnnotationsView();
		} else {
			// This case is unlikely with getRightLeaf(true) but good for robustness.
			new Notice("Could not open annotations sidebar.");
		}
	}

	/**
	 * Scans the current document and updates the annotations view.
	 */
	updateAnnotationsView() {
		const leaves = this.app.workspace.getLeavesOfType(OMNIDIAN_ANNOTATIONS_VIEW_TYPE);
		if (!leaves.length) {
			return;
		}
	
		const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
	
		if (activeMarkdownView) {
			// A markdown editor is active, so we should update the view with its content.
			// This is the normal operating path.
			const editor = activeMarkdownView.editor;
			const content = editor.getValue();
			const annotations: Annotation[] = [];
			
			const annotationRegex = /(?:(==(.*?)==)|(~~(.*?)~~))(?:<!--(.*?)-->)?/gs;
	
			for (const match of content.matchAll(annotationRegex)) {
				const isHighlight = !!match[1];
				const text = isHighlight ? match[2] : match[4];
				const commentRaw = match[5] || "";
				const color = isHighlight ? matchColor(commentRaw) : null;
				const commentClean = commentRaw.replace(`@${color}`, "").trim();
	
				if (match.index === undefined) continue;
				
				const from = match.index;
				const to = from + match[0].length;
	
				annotations.push({
					type: isHighlight ? 'highlight' : 'strikethrough',
					text: text.trim(),
					comment: commentClean,
					line: editor.offsetToPos(from).line,
					color: color,
					from: from,
					to: to,
				});
			}
			
			leaves.forEach(leaf => (leaf.view as OmnidianAnnotationsView).setData(annotations, editor));
		} else {
			// A markdown editor is NOT active. Check if our custom view is active.
			const activeAnnotationsView = this.app.workspace.getActiveViewOfType(OmnidianAnnotationsView);
			
			// If our own annotations view is active, DO NOTHING.
			if (activeAnnotationsView) {
				return;
			}
	
			// If we've reached this point, it means the user has switched to a
			// non-markdown view (like the File Explorer) or closed all panes.
			// In this case, it is correct to clear the annotations view.
			leaves.forEach(leaf => (leaf.view as OmnidianAnnotationsView).clear());
		}
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
		cleanup();
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