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

export default class OmnidianPlugin extends Plugin {
	settings: OmnidianSettings = DEFAULT_SETTINGS;
	isHighlightingModeOn = true;
	statusBarItemEl: HTMLElement | null = null;
	private selectionPopup: HTMLElement | null = null;
	// Handler for popup shortcuts
	private popupKeydownHandler: ((evt: KeyboardEvent) => void) | null = null;
	private readonly closingChars = [")", "]", "}", "\"", "'", "`", "*", "**", "_", "$"];

	async onload() {
		await this.loadSettings();
		// ... (standard setup calls are unchanged) ...
		this.app.workspace.onLayoutReady(() => {
			this.addRibbonIcon("highlighter", "Toggle editing mode", () => {
				this.toggleHighlightingMode();
			});
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

		this.registerDomEvent(document, "mouseup", this.selectionPopupHandler);
		this.registerDomEvent(document, "mousedown", this.documentMousedownHandler);
		this.registerDomEvent(document, "touchend", this.selectionPopupHandler);

		this.registerMarkdownPostProcessor(postprocessor);

		this.registerDomEvent(
			this.app.workspace.containerEl,
			"keydown",
			(evt: KeyboardEvent) => {
				if (!this.isHighlightingModeOn) return;

				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view) return;
				const editor = view.editor;

                // --- Auto-spacing after a final annotation block ---
                const isTypingKey = evt.key.length === 1 && !evt.ctrlKey && !evt.metaKey && !evt.altKey;
                if (isTypingKey && /\S/.test(evt.key)) { // It's a non-whitespace character
                    const cursor = editor.getCursor();
                    const lastLine = editor.lastLine();
                    const lastLineText = editor.getLine(lastLine);
                    // Check if cursor is at the very end of the document
                    if (cursor.line === lastLine && cursor.ch === lastLineText.length) {
                        const finalBlockRegex = /(?:==.*?==|~~.*?~~)(?:<!--.*?-->)?$/;
                        if (finalBlockRegex.test(lastLineText)) {
                            editor.replaceSelection(" ");
                        }
                    }
                }

				// --- Undo/Cut/Mid-line Enter prevention ---
				if ((evt.ctrlKey || evt.metaKey) && !evt.shiftKey) {
					const key = evt.key.toLowerCase();
					if (key === "z" || key === "x") {
						evt.preventDefault();
						evt.stopPropagation();
						return;
					}
				}
                // This rule only applies when NO text is selected.
				if (evt.key === "Enter" && !editor.somethingSelected()) {
					const cursor = editor.getCursor();
					if (cursor.line < editor.lastLine()) {
						evt.preventDefault();
						evt.stopPropagation();
						return;
					}
				}

                // --- CLASSIFICATION OF KEY PRESSES ---
                const isNavigationOrModifier = 
                    evt.key.startsWith('Arrow') || evt.key.startsWith('Page') ||
                    evt.key.startsWith('Home') || evt.key.startsWith('End') ||
                    evt.key.startsWith('Shift') || evt.key.startsWith('Control') ||
                    evt.key.startsWith('Alt') || evt.key.startsWith('Meta') ||
                    evt.key === 'Escape' ||
                    ((evt.ctrlKey || evt.metaKey) && ['a', 'c'].includes(evt.key.toLowerCase()));          
                
                // Explicitly define non-typing action keys to prevent them from being inserted as text.
                const isNonTypingActionKey = evt.key === 'CapsLock' || evt.key === 'Tab' || evt.key === 'Enter';


                // --- CORE TYPING LOGIC ---
                if (!isNavigationOrModifier && !isNonTypingActionKey && evt.key !== 'Backspace' && evt.key !== 'Delete') {
                    // This block now only runs for actual printable characters.
                    if (editor.somethingSelected()) {
                        evt.preventDefault();
                        evt.stopPropagation();
                        const endOfDoc = { line: editor.lastLine(), ch: editor.getLine(editor.lastLine()).length };
                        editor.setCursor(endOfDoc);
                        editor.replaceSelection(evt.key); // Manually insert the typed character
                        return; // We've handled the event.
                    }

                    const cursor = editor.getCursor();
                    const line = editor.getLine(cursor.line);
                    const lineLength = line.length;

                    // This handles typing in the middle of a line (without selection)
                    if (cursor.ch < lineLength) {
                        const charAfter = line.charAt(cursor.ch);
                        const isImmediatelyBeforeLastChar = cursor.ch === lineLength - 1;
                        if (isImmediatelyBeforeLastChar && this.closingChars.includes(charAfter)) {
                            return;
                        }
                        editor.setCursor({ line: editor.lastLine(), ch: editor.getLine(editor.lastLine()).length });
                    }
                }
                
                // Handle Tab and Enter with a selection to just deselect and move to the end.
                if (isNonTypingActionKey && editor.somethingSelected()) {
                    if (evt.key === 'Tab' || evt.key === 'Enter') {
                        evt.preventDefault();
                        evt.stopPropagation();
                        const endOfDoc = { line: editor.lastLine(), ch: editor.getLine(editor.lastLine()).length };
                        editor.setCursor(endOfDoc);
                        return;
                    }
                    // For CapsLock, we do nothing and let the OS handle it normally.
                }

				// --- BACKSPACE/DELETE to strikethrough logic ---
                if (evt.key === "Backspace" || evt.key === "Delete") {
                    let handled = false;
                    
                    if(editor.somethingSelected()){
                        createStrikethroughCommand(editor, this.settings.expandSelection);
                        editor.setCursor(editor.getCursor('to')); // Collapse selection
                        handled = true;
                    } else {
                        if (evt.key === "Backspace") {
                            handled = this.handleWordBackspace(editor);
                        } else { // evt.key === "Delete"
                            handled = this.handleWordDelete(editor);
                        }
                    }

                    if(handled){
                        evt.preventDefault();
                        evt.stopPropagation();
                    }
                }
			},
			true,
		);
	}
	
	
	private documentMousedownHandler = (evt: MouseEvent) => {
		if (this.selectionPopup && !this.selectionPopup.contains(evt.target as Node)) {
			this.removeSelectionPopup();
		}
	};

	private selectionPopupHandler = (evt: MouseEvent | TouchEvent) => {
		if (evt.target instanceof Element && evt.target.closest('#perink-selection-popup, #perink-comment-popover-container')) {
			return;
		}

		if (evt instanceof MouseEvent && evt.button !== 0) return;

		const editor = this.app.workspace.activeEditor?.editor;
		if (!editor) {
			this.removeSelectionPopup();
			return;
		}

		setTimeout(() => {
			if (editor.getSelection()) {
				this.createSelectionPopup(evt, editor);
			} else {
				this.removeSelectionPopup();
			}
		}, 10);
	};

	private createSelectionPopup(evt: MouseEvent | TouchEvent, editor: Editor) {
		this.removeSelectionPopup();
		if (evt instanceof MouseEvent && evt.button !== 0) return;

		const popup = document.createElement("div");
		popup.id = "perink-selection-popup";

		const strikethroughButton = popup.createEl("button", { text: "Cross out (Backspace/Delete)" });
		strikethroughButton.addEventListener("click", (e) => {
			e.stopPropagation();
			createStrikethroughCommand(editor, this.settings.expandSelection);
			this.removeSelectionPopup();
			editor.focus();
			editor.setCursor(editor.getCursor('to'));
		});

		const highlightButton = popup.createEl("button", { text: "Highlight (H)" });
		highlightButton.addEventListener("click", (e) => {
			e.stopPropagation();
			createHighlightCommand(editor, this.settings.expandSelection);
			this.removeSelectionPopup();
			editor.focus();
			editor.setCursor(editor.getCursor('to'));
		});

		document.body.appendChild(popup);
		this.selectionPopup = popup;

		this.popupKeydownHandler = (evt: KeyboardEvent) => {
			const key = evt.key.toLowerCase();
			
			if (key === 'h') {
				evt.stopPropagation();
				evt.preventDefault();
				createHighlightCommand(editor, this.settings.expandSelection);
				this.removeSelectionPopup();
				editor.focus();
				editor.setCursor(editor.getCursor('to'));
			} else if (key === 'backspace' || key === 'delete') {
				evt.stopPropagation();
				evt.preventDefault();
				createStrikethroughCommand(editor, this.settings.expandSelection);
				this.removeSelectionPopup();
				editor.focus();
				editor.setCursor(editor.getCursor('to'));
			} else {
				this.removeSelectionPopup();
			}
		};
		document.addEventListener('keydown', this.popupKeydownHandler, true);

		const selection = document.getSelection()?.getRangeAt(0).getBoundingClientRect();
		if (!selection) return;

		let top = selection.top - popup.offsetHeight - 5;
		let left = selection.left + selection.width / 2 - popup.offsetWidth / 2;

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

    // --- HELPER METHODS for Backspace/Delete logic ---

    private findAnnotationBlockAtCursor(editor: Editor, cursor: EditorPosition): { start: EditorPosition, end: EditorPosition } | null {
        const line = editor.getLine(cursor.line);
        const annotationRegex = /(?:==.*?==|~~.*?~~)(?:<!--.*?-->)?/g;
        let match;
        while ((match = annotationRegex.exec(line)) !== null) {
            const startPos = { line: cursor.line, ch: match.index };
            const endPos = { line: cursor.line, ch: match.index + match[0].length };
            if (cursor.ch >= startPos.ch && cursor.ch <= endPos.ch) {
                return { start: startPos, end: endPos };
            }
        }
        return null;
    }

    private expandToWordAtCursor(editor: Editor, cursor: EditorPosition): { from: EditorPosition; to: EditorPosition } | null {
        const line = editor.getLine(cursor.line);
        if (!line) return null;
        const isWordChar = (char: string) => char && /\w/.test(char);
        if (!isWordChar(line[cursor.ch]) && !isWordChar(line[cursor.ch - 1])) {
            return null;
        }
        let start = cursor.ch;
        let end = cursor.ch;
        while (start > 0 && isWordChar(line[start - 1])) {
            start--;
        }
        while (end < line.length && isWordChar(line[end])) {
            end++;
        }
        if (start === end) return null;
        return {
            from: { line: cursor.line, ch: start },
            to: { line: cursor.line, ch: end },
        };
    }

    private handleWordBackspace(editor: Editor): boolean {
        const cursor = editor.getCursor();
        const textAfter = editor.getRange(cursor, { line: editor.lastLine(), ch: Infinity });
        const charBefore = editor.getRange({ line: cursor.line, ch: cursor.ch - 1 }, cursor);

        if (!/\S/.test(textAfter) && !/\S/.test(charBefore)) {
            return false;
        }
        
        if (/\s/.test(charBefore)) {
            editor.setCursor({ line: cursor.line, ch: cursor.ch - 1 });
            return true;
        }

        const annotationBlock = this.findAnnotationBlockAtCursor(editor, cursor);
        if(annotationBlock) {
            editor.setCursor(annotationBlock.start);
            return true;
        }

        const wordRange = this.expandToWordAtCursor(editor, cursor);
        if (wordRange) {
            editor.setSelection(wordRange.from, wordRange.to);
            applyStrikethroughOnSelection(editor);
            editor.setCursor(wordRange.from);
            return true;
        } 
        
        editor.setCursor({ line: cursor.line, ch: cursor.ch - 1 });
        return true;
    }

    private handleWordDelete(editor: Editor): boolean {
        const cursor = editor.getCursor();
        const textAfter = editor.getRange(cursor, { line: editor.lastLine(), ch: Infinity });
        const charAfter = editor.getRange(cursor, { line: cursor.line, ch: cursor.ch + 1});

        if (!/\S/.test(textAfter)) {
            return false;
        }
        
        if (/\s/.test(charAfter)) {
            editor.setCursor({ line: cursor.line, ch: cursor.ch + 1 });
            return true;
        }

        const annotationBlock = this.findAnnotationBlockAtCursor(editor, cursor);
        if(annotationBlock) {
            editor.setCursor(annotationBlock.end);
            return true;
        }

        const wordRange = this.expandToWordAtCursor(editor, cursor);
        if (wordRange) {
            const originalLength = wordRange.to.ch - wordRange.from.ch;
            editor.setSelection(wordRange.from, wordRange.to);
            applyStrikethroughOnSelection(editor);
            editor.setCursor({ line: wordRange.from.line, ch: wordRange.from.ch + originalLength + 4 }); 
            return true;
        } 
        
        editor.setCursor({ line: cursor.line, ch: cursor.ch + 1 });
        return true;
    }


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
			this.statusBarItemEl.setAttribute("title", "Editing is restricted. Click to allow normal editing.");
		} else {
			this.statusBarItemEl.setText("Permanent Ink: OFF");
			this.statusBarItemEl.className = "status-bar-item is-inactive";
			this.statusBarItemEl.setAttribute("title", "Normal editing is allowed. Click to restrict editing.");
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