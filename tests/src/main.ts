import { Plugin, Editor, Notice, MarkdownView } from "obsidian";
import type { EditorTransaction } from "obsidian";

import {
	highlightExtension,
	cleanup as cleanupPopover,
} from "./editor/extension";
import { OmnidianSettingTab } from "@/settings";
import { createHighlightCommand } from "@/editor/commands";
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
	isModalOpen = false;
	isHighlightingModeOn = true; // Set default mode to ON
	statusBarItemEl: HTMLElement | null = null;
	private selectionPopup: HTMLElement | null = null;

	private readonly closingChars = [")", "]", "}", "\"", "'", "`", "*", "**", "_", "$"];

	async onload() {
		await this.loadSettings();

		this.app.workspace.onLayoutReady(() => {
			this.addRibbonIcon("highlighter", "Toggle highlighting mode", () => {
				this.toggleHighlightingMode();
			});
		});

		this.addStatusBarModeIndicator();
		this.registerEditorExtension([highlightExtension(this.settings.colors)]);

		this.addCommand({
			id: "create-highlight",
			name: "Highlight selection",
			editorCallback: (editor) =>
				createHighlightCommand(editor, this.settings.expandSelection),
		});

		this.addCommand({
			id: "toggle-highlighting-mode",
			name: "Toggle highlight mode",
			editorCallback: () => this.toggleHighlightingMode(),
		});

		this.addSettingTab(new OmnidianSettingTab(this.app, this));

		// Register handlers for the selection popup menu
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

				if ((evt.ctrlKey || evt.metaKey) && !evt.shiftKey) {
					const key = evt.key.toLowerCase();
					if (key === "z" || key === "x") {
						evt.preventDefault();
						evt.stopPropagation();
						return;
					}
				}

				if (evt.key === "Enter") {
					const cursor = editor.getCursor();
					if (cursor.line < editor.lastLine()) {
						evt.preventDefault();
						evt.stopPropagation();
						return;
					}
				}

                // --- FEATURE 2: PREVENT MID-LINE INSERTION ---
                // This logic forces all typing, pasting, and new lines to occur at the end of the very last line.
                // It works by moving the cursor to the end of the line *before* the default key action happens.
                
                // Define keys that should NOT trigger the "jump to end" behavior (e.g., navigation).
                const isNavigationOrModifier = 
                    evt.key.startsWith('Arrow') || 
                    evt.key.startsWith('Page') ||
                    evt.key.startsWith('Home') || 
                    evt.key.startsWith('End') ||
                    evt.key.startsWith('Shift') ||
                    evt.key.startsWith('Control') ||
                    evt.key.startsWith('Alt') ||
                    evt.key.startsWith('Meta') ||
                    evt.key === 'Tab' || 
                    evt.key === 'Escape';            

                
                // We only act if:
                // 1. The key is NOT for navigation/modification.
                // 2. The key is NOT Backspace or Delete (handled by Feature 3).
                if (!isNavigationOrModifier && evt.key !== 'Backspace' && evt.key !== 'Delete') {
                    const cursor = editor.getCursor();
                    const line = editor.getLine(cursor.line);
                    const lineLength = line.length;
                    const lastLineNum = editor.lastLine();
                    const lastLineLength = editor.getLine(lastLineNum).length;

                    // Only interfere if the cursor is not already at the end.
                    if (cursor.ch < lineLength) {
                        
                        // --- EXCEPTION LOGIC ---
                        // We check for a very specific case: is the cursor right before a 
                        // closing character that is ALSO the very last character on the line?
                        // This allows typing inside newly created auto-pairs, like `(|)`.
                        
                        const charAfter = line.charAt(cursor.ch);
                        const isImmediatelyBeforeLastChar = cursor.ch === lineLength - 1;

                        // Check if the character after the cursor is a known "closing" character
                        // AND if it's the last character on the line.
                        if (isImmediatelyBeforeLastChar && this.closingChars.includes(charAfter)) {
                            // This is the one approved case for mid-line insertion.
                            // We do nothing and let the user type.
                            return; 
                        }

                        // For ALL OTHER cases of mid-line insertion, move the cursor to the very end.
                        editor.setCursor({ line: lastLineNum, ch: lastLineLength });
                    }
                }

				if (evt.key !== "Backspace" && evt.key !== "Delete") return;
				
				let handled = false;
				if (evt.key === "Backspace") handled = this.handleBackspaceAction(editor);
				else if (evt.key === "Delete") handled = this.handleDeleteAction(editor);

				if (handled) {
					evt.preventDefault();
					evt.stopPropagation();
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
		// Only trigger on mouseup if it's the primary button
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

		const popup = document.createElement("div");
		popup.id = "perink-selection-popup";

		const strikethroughButton = popup.createEl("button", { text: "Cross out" });
		strikethroughButton.addEventListener("click", () => {
			this.applyStrikethroughToSelection(editor);
			this.removeSelectionPopup();
			editor.focus();
		});

		const highlightButton = popup.createEl("button", { text: "Highlight" });
		highlightButton.addEventListener("click", () => {
			createHighlightCommand(editor, this.settings.expandSelection);
			this.removeSelectionPopup();
			editor.focus();
		});

		document.body.appendChild(popup);
		this.selectionPopup = popup;

		const selection = document.getSelection()?.getRangeAt(0).getBoundingClientRect();
		if (!selection) return;

		let top = selection.top - popup.offsetHeight - 5;
		let left = selection.left + selection.width / 2 - popup.offsetWidth / 2;

		if(top < 5){ // If popup would be off-screen at the top, place it below
			top = selection.bottom + 5;
		}
		if(left < 5) left = 5; // Prevent going off-screen left

		popup.style.top = `${top}px`;
		popup.style.left = `${left}px`;
	}

	private removeSelectionPopup() {
		this.selectionPopup?.remove();
		this.selectionPopup = null;
	}

	toggleHighlightingMode() {
		this.isHighlightingModeOn = !this.isHighlightingModeOn;
		this.updateStatusBar();
		new Notice(`Highlighting mode ${this.isHighlightingModeOn ? "ON" : "OFF"}`);
	}

	addStatusBarModeIndicator() {
		this.statusBarItemEl = this.addStatusBarItem();
		this.updateStatusBar();
		this.statusBarItemEl.addEventListener("click", () => this.toggleHighlightingMode());
	}

	private updateStatusBar(): void {
		if (!this.statusBarItemEl) return;
		if (this.isHighlightingModeOn) {
			this.statusBarItemEl.setText("Highlighting Mode: ON");
			this.statusBarItemEl.className = "status-bar-item is-active";
			this.statusBarItemEl.setAttribute("title", "Highlighting Mode is ON. Editing is restricted. Click to disable.");
		} else {
			this.statusBarItemEl.setText("Highlighting Mode: OFF");
			this.statusBarItemEl.className = "status-bar-item is-inactive";
			this.statusBarItemEl.setAttribute("title", "Highlighting Mode is OFF. Click to enable.");
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

	private countTildes(s: string): number {
		return (s.match(/~~/g) || []).length;
	}

	private processLine(editor: Editor,lineNumber: number, startCh: number, endCh: number): string {
		const fullLineText = editor.getLine(lineNumber);
		let lineSelection = fullLineText.substring(startCh, endCh);

		if (lineSelection.startsWith("~") && !lineSelection.startsWith("~~") && startCh > 0) {
			if (fullLineText.charAt(startCh - 1) === "~") startCh--;
		}
		if (lineSelection.endsWith("~") && !lineSelection.endsWith("~~")) {
			if (fullLineText.charAt(endCh) === "~") endCh++;
		}
		lineSelection = fullLineText.substring(startCh, endCh);

		const textBefore = fullLineText.substring(0, startCh);
		const textAfter = fullLineText.substring(endCh);
		const tildesInSelection = this.countTildes(lineSelection);
		const tildesBefore = this.countTildes(textBefore);
		const tildesAfter = this.countTildes(textAfter);
		const cleanedSelection = lineSelection.replace(/~~/g, "");

		if (tildesInSelection === 0 && tildesBefore % 2 === 1) {
			return textBefore + lineSelection + textAfter;
		}

		if (tildesInSelection > 0 && tildesInSelection % 2 === 0) {
			if (tildesBefore % 2 === 0 && tildesAfter % 2 === 0) {
				const isBefore = textBefore.endsWith("~~");
				const isAfter = textAfter.startsWith("~~");
				if ((lineSelection.startsWith("~~") || lineSelection.endsWith("~~")) && !isBefore && !isAfter) {
					return textBefore + "~~" + cleanedSelection + "~~" + textAfter;
				}
				if (isBefore && isAfter) return textBefore.slice(0, -2) + cleanedSelection + textAfter.slice(2);
				if (isBefore) return textBefore.slice(0, -2) + cleanedSelection + "~~" + textAfter;
				if (isAfter) return textBefore + "~~" + cleanedSelection + textAfter.slice(2);
				if (lineSelection.startsWith("~~") && lineSelection.endsWith("~~")) {
					return textBefore + "~~" + cleanedSelection + "~~" + textAfter;
				}
			} else if (tildesBefore % 2 === 1 && tildesAfter % 2 === 1) {
				return textBefore + cleanedSelection + textAfter;
			}
		}

		if (tildesInSelection % 2 === 1) {
			if (tildesBefore % 2 === 0) {
				if (textBefore.endsWith("~~")) return textBefore.slice(0, -2) + cleanedSelection + textAfter;
				if (textAfter.startsWith("~~")) return textBefore + cleanedSelection + textAfter.slice(2);
				return textBefore + "~~" + cleanedSelection + textAfter;
			} else {
				if (textAfter.startsWith("~~")) return textBefore + cleanedSelection + textAfter.slice(2);
				else return textBefore + cleanedSelection + "~~" + textAfter;
			}
		}

		if (this.countTildes(lineSelection) > 0) {
			return textBefore + "~~" + cleanedSelection + "~~" + textAfter;
		} else {
			return textBefore + "~~" + lineSelection + "~~" + textAfter;
		}
	}

	private applyStrikethroughToSelection(editor: Editor): boolean {
		if (!editor.somethingSelected()) return false;
		
		const from = editor.getCursor("from");
		const to = editor.getCursor("to");
		const processedLines: string[] = [];

		for (let i = from.line; i <= to.line; i++) {
			const fullLineText = editor.getLine(i);
			let startCh = i === from.line ? from.ch : 0;
			let endCh = i === to.line ? to.ch : fullLineText.length;
			while (startCh < endCh && /\s/.test(fullLineText.charAt(startCh))) startCh++;
			while (endCh > startCh && /\s/.test(fullLineText.charAt(endCh - 1))) endCh--;
			if (startCh >= endCh) {
				processedLines.push(fullLineText);
				continue;
			}
			const newLine = this.processLine(editor, i, startCh, endCh);
			processedLines.push(newLine);
		}
		editor.replaceRange(processedLines.join("\n"), { line: from.line, ch: 0 }, { line: to.line, ch: editor.getLine(to.line).length });
		return true;
	}

	private handleBackspaceAction(editor: Editor): boolean {
		if (this.applyStrikethroughToSelection(editor)) return true;
		
		const cursor = editor.getCursor();
		const lineText = editor.getLine(cursor.line);

		if (lineText.trim() === "") return true;
		if (cursor.ch === 0 && cursor.line > 0) {
			if (editor.getLine(cursor.line - 1).trim() === '') return true;
		}
		if (cursor.line === 0 && cursor.ch === 0) return false;

		const fromPos = { line: cursor.line, ch: cursor.ch - 1 };
		const toPos = cursor;
		const char = editor.getRange(fromPos, toPos);

		if (!char || char === "\n") return true;
		if (char === " ") {
			editor.setCursor({ line: cursor.line, ch: cursor.ch - 1 });
			return true;
		}

		if (cursor.ch > 1 && lineText.substring(cursor.ch - 2, cursor.ch) === "~~") {
			const searchArea = lineText.substring(0, cursor.ch - 2);
			const openingTildePos = searchArea.lastIndexOf("~~");
			if (openingTildePos !== -1) {
				const blockContent = searchArea.substring(openingTildePos);
				if ((blockContent.match(/~~/g) || []).length % 2 === 1) {
					editor.setCursor({ line: cursor.line, ch: openingTildePos });
					return true;
				}
			}
		}

		if (char === "~") return true;

		let transaction: EditorTransaction;
		const textAfter = editor.getRange(cursor, { line: cursor.line, ch: cursor.ch + 2 });
		const textBefore = cursor.ch >= 3 ? editor.getRange({ line: cursor.line, ch: cursor.ch - 3 }, fromPos) : "";
		const textBeforeCursorOnLine = lineText.substring(0, cursor.ch);
		const textAfterCursorOnLine = lineText.substring(cursor.ch);
		const tildeCountBefore = this.countTildes(textBeforeCursorOnLine);
		const tildeCountAfter = this.countTildes(textAfterCursorOnLine);
		const lastOpeningTildePos = textBeforeCursorOnLine.lastIndexOf("~~");
		const firstClosingTildePos = textAfterCursorOnLine.indexOf("~~");

		if (textBefore === "~~" && textAfter === "~~" && tildeCountAfter % 2 == 0) {
			transaction = { changes: [{ from: { line: cursor.line, ch: cursor.ch - 3 }, to: { line: cursor.line, ch: cursor.ch + 2 }, text: `${char}` }] };
		} else if (tildeCountBefore % 2 === 1 && tildeCountAfter > 0) {
			const fullClosingTildePos = cursor.ch + firstClosingTildePos;
			if ((lineText.substring(lastOpeningTildePos, fullClosingTildePos + 2).match(/~~/g) || []).length === 2) {
				editor.setCursor({ line: cursor.line, ch: lastOpeningTildePos });
				return true;
			}
			return true;
		} else if (textBefore === "~~") {
			transaction = { changes: [{ from: { line: cursor.line, ch: cursor.ch - 3 }, to: cursor, text: `${char}~~` }] };
		} else if (textAfter === "~~") {
			transaction = { changes: [{ from: fromPos, to: { line: cursor.line, ch: cursor.ch + 2 }, text: `~~${char}` }], selection: { from: fromPos } };
		} else {
			transaction = { changes: [{ from: fromPos, to: toPos, text: `~~${char}~~` }], selection: { from: fromPos } };
		}
		editor.transaction(transaction);
		return true;
	}

	private handleDeleteAction(editor: Editor): boolean {
		if (this.applyStrikethroughToSelection(editor)) return true;

		const cursor = editor.getCursor();
		const lineText = editor.getLine(cursor.line);

		if (lineText.trim() === "") return true;
		if (cursor.ch === lineText.length && cursor.line < editor.lastLine()) {
			if (editor.getLine(cursor.line + 1).trim() === "") return true;
		}
		if (cursor.ch === lineText.length && cursor.line === editor.lastLine()) return false;

		const fromPos = cursor;
		const toPos = { line: cursor.line, ch: cursor.ch + 1 };
		const char = editor.getRange(fromPos, toPos);

		if (!char || char === "\n") return true;
		if (char === " ") {
			editor.setCursor({ line: cursor.line, ch: cursor.ch + 1 });
			return true;
		}

		if (cursor.ch < lineText.length - 1 && lineText.substring(cursor.ch, cursor.ch + 2) === "~~") {
			const searchArea = lineText.substring(cursor.ch + 2);
			const closingTildePosInSearchArea = searchArea.indexOf("~~");
			if (closingTildePosInSearchArea !== -1) {
				const absoluteClosingTildePos = cursor.ch + 2 + closingTildePosInSearchArea;
				if ((lineText.substring(cursor.ch, absoluteClosingTildePos + 2).match(/~~/g) || []).length === 2) {
					editor.setCursor({ line: cursor.line, ch: absoluteClosingTildePos + 2 });
					return true;
				}
			}
		}

		if (char === "~") return true;

		let transaction: EditorTransaction;
		const textAfter = editor.getRange(toPos, { line: toPos.line, ch: toPos.ch + 2 });
		const textBefore = cursor.ch >= 2 ? editor.getRange({ line: cursor.line, ch: cursor.ch - 2 }, cursor) : "";
		const textBeforeCursorOnLine = lineText.substring(0, cursor.ch);
		const textAfterCursorOnLine = lineText.substring(cursor.ch);
		const tildeCountBefore = this.countTildes(textBeforeCursorOnLine);
		const tildeCountAfter = this.countTildes(textAfterCursorOnLine.substring(1));
		const lastOpeningTildePos = textBeforeCursorOnLine.lastIndexOf("~~");
		const firstClosingTildePosInAfter = textAfterCursorOnLine.indexOf("~~");
		const firstClosingTildePos = firstClosingTildePosInAfter !== -1 ? cursor.ch + firstClosingTildePosInAfter : -1;

		if (textBefore === "~~" && textAfter === "~~" && tildeCountAfter % 2 == 0) {
			transaction = { changes: [{ from: { line: cursor.line, ch: cursor.ch - 2 }, to: { line: cursor.line, ch: cursor.ch + 3 }, text: `${char}` }] };
		} else if (tildeCountBefore % 2 === 1 && firstClosingTildePos !== -1) {
			if ((lineText.substring(lastOpeningTildePos, firstClosingTildePos + 2).match(/~~/g) || []).length === 2) {
				editor.setCursor({ line: cursor.line, ch: firstClosingTildePos + 2 });
				return true;
			}
			return true;
		} else if (textBefore === "~~") {
			transaction = { changes: [{ from: { line: cursor.line, ch: cursor.ch - 2 }, to: toPos, text: `${char}~~` }], selection: { from: { line: cursor.line, ch: cursor.ch + 1 } } };
		} else if (textAfter === "~~") {
			transaction = { changes: [{ from: fromPos, to: { line: cursor.line, ch: cursor.ch + 3 }, text: `~~${char}` }], selection: { from: cursor } };
		} else {
			transaction = { changes: [{ from: fromPos, to: toPos, text: `~~${char}~~` }], selection: { from: { line: cursor.line, ch: cursor.ch + 5 } } };
		}
		editor.transaction(transaction);
		return true;
	}
}