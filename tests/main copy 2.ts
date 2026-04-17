import { Plugin, Editor, Notice, MarkdownView, EditorTransaction, WorkspaceLeaf } from 'obsidian';
import { AnnotationView, ANNOTATION_VIEW_TYPE, Annotation } from './view';

// Define the structure for our saved data
interface PermanentInkData {
    annotations: Record<string, Annotation[]>; // Maps a file path to an array of its annotations
}

const DEFAULT_DATA: PermanentInkData = {
    annotations: {}, 
};

export default class StrikethroughOnKeyPlugin extends Plugin {
    data: PermanentInkData;
    private statusBarItem: HTMLElement;
    private isEnabled: boolean = true;
    private readonly closingChars = [')', ']', '}', '"', "'", '`', '*', '**', '_', '$'];

    async onload() {
        console.log('Loading Permanent Ink plugin');
        await this.loadPluginData(); // Load saved annotations

        this.statusBarItem = this.addStatusBarItem();
        this.statusBarItem.addEventListener('click', () => this.togglePluginState());
        this.app.workspace.onLayoutReady(() => {
            this.addRibbonIcon('strikethrough', 'Toggle Permanent Ink', () => this.togglePluginState());
        });
        this.updateStatusBar();

        // Pass the plugin instance itself to the view
        this.registerView(ANNOTATION_VIEW_TYPE, (leaf) => new AnnotationView(leaf, this));

        this.addCommand({ id: 'reveal-annotation-view', name: 'Show Annotations', callback: () => this.activateView() });

        this.registerDomEvent(this.app.workspace.containerEl, 'keydown', (evt: KeyboardEvent) => this.handleKeyDown(evt), true);
    }

    async loadPluginData() {
        this.data = Object.assign({}, DEFAULT_DATA, await this.loadData());
    }

    async savePluginData() {
        await this.saveData(this.data);
    }

    // Centralized method to add an annotation and save
    async addAnnotation(annotation: Annotation) {
        const path = annotation.filePath;
        if (!this.data.annotations[path]) {
            this.data.annotations[path] = [];
        }
        this.data.annotations[path].push(annotation);
        await this.savePluginData();
        this.updateAnnotationView(); // Refresh the sidebar
    }

    // Centralized method to delete an annotation and save
    async deleteAnnotation(annotationId: string, filePath: string) {
        if (this.data.annotations[filePath]) {
            this.data.annotations[filePath] = this.data.annotations[filePath].filter(a => a.id !== annotationId);
            if (this.data.annotations[filePath].length === 0) {
                delete this.data.annotations[filePath]; // Clean up empty arrays
            }
            await this.savePluginData();
            this.updateAnnotationView(); // Refresh the sidebar
        }
    }
    
    getAnnotationsForFile(path: string): Annotation[] {
        return this.data.annotations[path] || [];
    }

    // Helper to refresh the view if it's open
    updateAnnotationView() {
        const leaf = this.app.workspace.getLeavesOfType(ANNOTATION_VIEW_TYPE)[0];
        if (leaf && leaf.view instanceof AnnotationView) {
            leaf.view.redraw();
        }
    }
    
    handleKeyDown(evt: KeyboardEvent) {
        if (!this.isEnabled) return;
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) return;
        const editor = view.editor;

        const isNavKey = evt.key.startsWith('Arrow') || evt.key.startsWith('Page') || evt.key.startsWith('Home') || evt.key.startsWith('End') || ['Shift', 'Tab', 'Escape'].contains(evt.key);
        const isModifier = evt.ctrlKey || evt.altKey || evt.metaKey;
        const isSpecialKey = isNavKey || isModifier;
        const isDeletion = evt.key === 'Backspace' || evt.key === 'Delete';

        // Annotation on selection: A printable character is typed on a selection
        if (editor.somethingSelected() && !isSpecialKey && !isDeletion) {
            evt.preventDefault();
            evt.stopPropagation();
            this.createAnnotationFromSelection(editor, evt.key); // Pass the key
            return;
        }

        if (isModifier) { // Handle Undo/Cut after the selection check
             if (!evt.shiftKey && (evt.key.toLowerCase() === 'z' || evt.key.toLowerCase() === 'x')) {
                evt.preventDefault(); evt.stopPropagation(); return;
             }
             return; // Other modifier combos should proceed
        }

        // --- PREVENT CREATING NEW LINES IN THE MIDDLE OF THE DOCUMENT ---
        if (evt.key === 'Enter') {
            const cursor = editor.getCursor();
            const lastLineNum = editor.lastLine();
            
            // Only check if we are not on the very last line
            if (cursor.line < lastLineNum) {
                let hasContentAfter = false;
                // Loop from the line *after* the cursor to the end of the document
                for (let i = cursor.line + 1; i <= lastLineNum; i++) {
                    if (editor.getLine(i).trim() !== '') {
                        hasContentAfter = true;
                        break; // Found content, no need to check further
                    }
                }
                
                if (hasContentAfter) {
                    evt.preventDefault();
                    evt.stopPropagation();
                    new Notice("New lines can only be added at the end of the document.");
                    return;
                }
            }
        }


        // Annotation on mid-line typing
        if (!isNavKey && !isDeletion && !editor.somethingSelected()) {
            const cursor = editor.getCursor();
            const line = editor.getLine(cursor.line);
            if (cursor.ch < line.length) {
                 if (cursor.ch === line.length - 1 && this.closingChars.includes(line.charAt(cursor.ch))) return;
                evt.preventDefault(); evt.stopPropagation();
                this.createAnnotationAtCursor(editor, evt.key); // Pass the key
                return;
            }
        }
        
        if (isDeletion) {
            let handled = (evt.key === 'Backspace') ? this.handleBackspaceAction(editor) : this.handleDeleteAction(editor);
            if (handled) { evt.preventDefault(); evt.stopPropagation(); }
        }
    }

    onunload() { this.statusBarItem?.remove(); this.app.workspace.detachLeavesOfType(ANNOTATION_VIEW_TYPE); }
    async activateView(): Promise<AnnotationView> { let leaf = this.app.workspace.getLeavesOfType(ANNOTATION_VIEW_TYPE)[0]; if (!leaf) { leaf = this.app.workspace.getRightLeaf(true) as WorkspaceLeaf; await leaf.setViewState({ type: ANNOTATION_VIEW_TYPE, active: true }); } this.app.workspace.revealLeaf(leaf); return leaf.view as AnnotationView; }
    
    async createAnnotationAtCursor(editor: Editor, initialChar: string) {
        const view = await this.activateView();
        const cursor = editor.getCursor();
        const file = this.app.workspace.getActiveFile();
        if (!file) return;
        view.createNewAnnotationInput({ id: Date.now().toString(), filePath: file.path, line: cursor.line, ch: cursor.ch }, initialChar);
    }
    
    async createAnnotationFromSelection(editor: Editor, initialChar: string) {
        if (!editor.somethingSelected()) return;

        const file = this.app.workspace.getActiveFile();
        if (!file) return;

        // Get selection details
        const from = editor.getCursor('from');
        const to = editor.getCursor('to');
        const selectedText = editor.getRange(from, to);

        // --- THE KEY CHANGE ---
        // Replace the selection with the same text, but highlighted.
        // This provides immediate visual feedback that the text has been "annotated".
        const newText = `==${selectedText}==`;
        editor.replaceRange(newText, from, to);

        // Now, create the annotation data. The original `from` and `to`
        // coordinates still correctly point to the original text content.
        const view = await this.activateView();
        new Notice("Annotation started. Type in the sidebar.");
        view.createNewAnnotationInput(
            { 
                id: Date.now().toString(), 
                filePath: file.path, 
                line: from.line, 
                ch: from.ch, 
                endLine: to.line, 
                endCh: to.ch 
            }, 
            initialChar
        );
        
        // Move cursor to the end of the new struck-through text
        // The new end character is the original 'to' position + 4 characters (for the four '~')
        // This is tricky for multi-line, so a simpler approach is to set it relative to 'from'
        const newToCh = from.line === to.line ? from.ch + newText.length : to.ch + 2;
        const newToLine = to.line;
        editor.setCursor({ line: newToLine, ch: newToCh });
    }


    // --- PLUGIN STATE AND UI METHODS (Unchanged) ---

    private togglePluginState(): void {
        this.isEnabled = !this.isEnabled;
        this.updateStatusBar();
        new Notice(`Permanent Ink is now ${this.isEnabled ? 'ON' : 'OFF'}`);
    }

    private updateStatusBar(): void {
        if (!this.statusBarItem) return;
        if (this.isEnabled) {
            this.statusBarItem.setText('Permanent Ink: ON');
            this.statusBarItem.className = 'status-bar-item is-active';
            this.statusBarItem.setAttribute('title', 'Permanent Ink is ON. Click to disable.');
        } else {
            this.statusBarItem.setText('Permanent Ink: OFF');
            this.statusBarItem.className = 'status-bar-item is-inactive';
            this.statusBarItem.setAttribute('title', 'Permanent Ink is OFF. Click to enable.');
        }
    }

    // --- FEATURE 3: STRIKETHROUGH LOGIC (All Unchanged) ---
    /**
     * Helper function to count '~~' occurrences.
     */
    private countTildes = (s: string): number => (s.match(/~~/g) || []).length;
    /**
     * Processes a single line of a selection based on a set of logical rules.
     * @returns The entire processed line as a string.
     */
    private processLine = (editor: Editor, lineNumber: number, startCh: number, endCh: number): string => {
        const fullLineText = editor.getLine(lineNumber);
        let lineSelection = fullLineText.substring(startCh, endCh);
        // --- RULE 1: SMART SELECTION EXPANSION (for this line) ---
        if (lineSelection.startsWith('~') && !lineSelection.startsWith('~~') && startCh > 0) { if (fullLineText.charAt(startCh - 1) === '~') startCh--; }
        if (lineSelection.endsWith('~') && !lineSelection.endsWith('~~')) { if (fullLineText.charAt(endCh) === '~') endCh++; }
        lineSelection = fullLineText.substring(startCh, endCh);
        // After potential expansion, get the final context.
        const textBefore = fullLineText.substring(0, startCh);
        const textAfter = fullLineText.substring(endCh);
        const tildesInSelection = this.countTildes(lineSelection);
        const tildesBefore = this.countTildes(textBefore);
        const tildesAfter = this.countTildes(textAfter);
        const cleanedSelection = lineSelection.replace(/~~/g, '');
        // --- RULE 2: EVEN `~~` IN SELECTION ---
        if (tildesInSelection > 0 && tildesInSelection % 2 === 0) {
            if (tildesBefore % 2 === 0 && tildesAfter % 2 === 0) {
                const isBefore = textBefore.endsWith('~~');
                const isAfter = textAfter.startsWith('~~');
                if (lineSelection.startsWith('~~') || lineSelection.endsWith('~~') && !isBefore && !isAfter) { return textBefore + '~~' + cleanedSelection + '~~' + textAfter; }
                if (isBefore && isAfter) { return textBefore.slice(0, -2) + cleanedSelection + textAfter.slice(2); }
                if (isBefore) { return textBefore.slice(0, -2) + cleanedSelection + '~~' + textAfter; }
                if (isAfter) { return textBefore + '~~' + cleanedSelection + textAfter.slice(2); }
                if (lineSelection.startsWith('~~') && lineSelection.endsWith('~~')) { return textBefore + '~~' + cleanedSelection + '~~' + textAfter; }
            }
            else if (tildesBefore % 2 === 1 && tildesAfter % 2 === 1) { return textBefore + cleanedSelection + textAfter; }
        }
        // --- RULE 3: ODD `~~` IN SELECTION ---
        if (tildesInSelection % 2 === 1) {
            if (tildesBefore % 2 === 0) {
                if (textBefore.endsWith('~~')) { return textBefore.slice(0, -2) + cleanedSelection + textAfter; }
                if (textAfter.startsWith('~~')) { return textBefore + cleanedSelection + textAfter.slice(2); }
                return textBefore + '~~' + cleanedSelection + textAfter;
            } else {
                if (textAfter.startsWith('~~')) { return textBefore + cleanedSelection + textAfter.slice(2); }
                else { return textBefore + cleanedSelection + '~~' + textAfter; }
            }
        }
        // --- DEFAULT BEHAVIOR: SIMPLE WRAP/UNWRAP TOGGLE ---
        if (this.countTildes(lineSelection) > 0) { return textBefore + '~~' + cleanedSelection + '~~' + textAfter; }
        else { return textBefore + '~~' + lineSelection + '~~' + textAfter; }
    }

    /**
     * Main handler for selections, processing each line individually.
     */
    private handleSelection = (editor: Editor): boolean => {
        if (!editor.somethingSelected()) return false;
        const from = editor.getCursor('from');
        const to = editor.getCursor('to');
        const processedLines: string[] = [];
        // Iterate through each line in the selection.
        for (let i = from.line; i <= to.line; i++) {
            // Determine the start and end character positions for the selection on this specific line.
            const fullLineText = editor.getLine(i);
            let startCh = (i === from.line) ? from.ch : 0;
            let endCh = (i === to.line) ? to.ch : fullLineText.length;
            // --- Adjust startCh/endCh to skip leading whitespace within the selection on this line ---
            while (startCh < endCh && /\s/.test(fullLineText.charAt(startCh))) { startCh++; }
            while (endCh > startCh && /\s/.test(fullLineText.charAt(endCh - 1))) { endCh--; }
            
            if (startCh >= endCh) { processedLines.push(fullLineText); continue; }
            
            const newLine = this.processLine(editor, i, startCh, endCh);
            processedLines.push(newLine);
        }
        // Replace the original selection range with the newly processed lines.
        editor.replaceRange(processedLines.join('\n'), { line: from.line, ch: 0 }, { line: to.line, ch: editor.getLine(to.line).length });
        return true;
    }

    /**
     * Implements the custom Backspace logic.
     * @param editor The active editor instance.
     * @returns `true` if the event was handled, `false` to allow default behavior.
     */
    private handleBackspaceAction = (editor: Editor): boolean => {
        // If there's a selection, the dedicated handler takes precedence.
        if (this.handleSelection(editor)) return true;
        const cursor = editor.getCursor();
        const lineText = editor.getLine(cursor.line);
        // --- PREVENT DELETING EMPTY LINES ---
        if (lineText.trim() === '') return true;
        // If at the start of a line, prevent merging with a blank line above.
        if (cursor.ch === 0 && cursor.line > 0) { if (editor.getLine(cursor.line - 1).trim() === '') return true; }
        // At the very start of the document, allow default behavior (which is nothing).
        if (cursor.line === 0 && cursor.ch === 0) return false;
        
        const fromPos = { line: cursor.line, ch: cursor.ch - 1 };
        const toPos = cursor;
        const char = editor.getRange(fromPos, toPos);
        // Prevent merging non-empty lines
        if (!char || char === '\n') return true;
        // Instead of deleting a space, just move the cursor left.
        if (char === ' ') { editor.setCursor({ line: cursor.line, ch: cursor.ch - 1 }); return true; }
        
        if (cursor.ch > 1 && lineText.substring(cursor.ch - 2, cursor.ch) === '~~') {
            const searchArea = lineText.substring(0, cursor.ch - 2);
            const openingTildePos = searchArea.lastIndexOf('~~');
            if (openingTildePos !== -1) {
                const blockContent = searchArea.substring(openingTildePos);
                if ((blockContent.match(/~~/g) || []).length % 2 === 1) { editor.setCursor({ line: cursor.line, ch: openingTildePos }); return true; }
            }
        }
        // Prevent deleting the tilde characters themselves in other contexts.
        if (char === '~') return true;

        let transaction: EditorTransaction;
        // Check the text immediately surrounding the character to be deleted.
        const textAfter = editor.getRange(cursor, { line: cursor.line, ch: cursor.ch + 2 });
        const textBefore = cursor.ch >= 3 ? editor.getRange({ line: cursor.line, ch: cursor.ch - 3 }, fromPos) : '';
        // For more complex logic, we need context from the entire line.
        const textBeforeCursorOnLine = lineText.substring(0, cursor.ch);
        const textAfterCursorOnLine = lineText.substring(cursor.ch);
        const tildeCountBefore = (textBeforeCursorOnLine.match(/~~/g) || []).length;
        const tildeCountAfter = (textAfterCursorOnLine.match(/~~/g) || []).length;
        const lastOpeningTildePos = textBeforeCursorOnLine.lastIndexOf('~~');
        const firstClosingTildePos = textAfterCursorOnLine.indexOf('~~');
        if (textBefore === '~~' && textAfter === '~~' && tildeCountAfter % 2 == 0) {
            transaction = { changes: [{ from: { line: cursor.line, ch: cursor.ch - 3 }, to: { line: cursor.line, ch: cursor.ch + 2 }, text: `${char}` }] };
        } else if (tildeCountBefore % 2 === 1 && tildeCountAfter > 0) {
            const fullClosingTildePos = cursor.ch + firstClosingTildePos;
            const potentialBlock = lineText.substring(lastOpeningTildePos, fullClosingTildePos + 2);
            if ((potentialBlock.match(/~~/g) || []).length === 2) { editor.setCursor({ line: cursor.line, ch: lastOpeningTildePos }); return true; }
            return true;
        } else if (textBefore === '~~') {
            transaction = { changes: [{ from: { line: cursor.line, ch: cursor.ch - 3 }, to: cursor, text: `${char}~~` }] };
        } else if (textAfter === '~~') {
            transaction = { changes: [{ from: fromPos, to: { line: cursor.line, ch: cursor.ch + 2 }, text: `~~${char}` }], selection: { from: fromPos } };
        } else {
            transaction = { changes: [{ from: fromPos, to: toPos, text: `~~${char}~~` }], selection: { from: fromPos } };
        }
        editor.transaction(transaction);
        return true;
    }

    /**
     * Implements the custom Delete logic.
     * @param editor The active editor instance.
     * @returns `true` if the event was handled, `false` to allow default behavior.
     */
    private handleDeleteAction = (editor: Editor): boolean => {
        if (this.handleSelection(editor)) return true;
        const cursor = editor.getCursor();
        const lineText = editor.getLine(cursor.line);
        if (lineText.trim() === '') return true;
        if (cursor.ch === lineText.length && cursor.line < editor.lastLine()) { if (editor.getLine(cursor.line + 1).trim() === '') return true; }
        if (cursor.ch === lineText.length && cursor.line === editor.lastLine()) return false;
        const fromPos = cursor;
        const toPos = { line: cursor.line, ch: cursor.ch + 1 };
        const char = editor.getRange(fromPos, toPos);
        if (!char || char === '\n') return true;
        if (char === ' ') { editor.setCursor({ line: cursor.line, ch: cursor.ch + 1 }); return true; }
        if (cursor.ch < lineText.length - 1 && lineText.substring(cursor.ch, cursor.ch + 2) === '~~') {
            const searchArea = lineText.substring(cursor.ch + 2);
            const closingTildePosInSearchArea = searchArea.indexOf('~~');
            if (closingTildePosInSearchArea !== -1) {
                const absoluteClosingTildePos = cursor.ch + 2 + closingTildePosInSearchArea;
                const potentialBlock = lineText.substring(cursor.ch, absoluteClosingTildePos + 2);
                if ((potentialBlock.match(/~~/g) || []).length === 2) { editor.setCursor({ line: cursor.line, ch: absoluteClosingTildePos + 2 }); return true; }
            }
        }
        if (char === '~') return true;
        let transaction: EditorTransaction;
        const textAfter = editor.getRange(toPos, { line: toPos.line, ch: toPos.ch + 2 });
        const textBefore = cursor.ch >= 2 ? editor.getRange({ line: cursor.line, ch: cursor.ch - 2 }, cursor) : '';
        const textBeforeCursorOnLine = lineText.substring(0, cursor.ch);
        const textAfterCursorOnLine = lineText.substring(cursor.ch);
        const tildeCountBefore = (textBeforeCursorOnLine.match(/~~/g) || []).length;
        const tildeCountAfter = (textAfterCursorOnLine.substring(1).match(/~~/g) || []).length;
        const lastOpeningTildePos = textBeforeCursorOnLine.lastIndexOf('~~');
        const firstClosingTildePosInAfter = textAfterCursorOnLine.indexOf('~~');
        const firstClosingTildePos = (firstClosingTildePosInAfter !== -1) ? cursor.ch + firstClosingTildePosInAfter : -1;
        if (textBefore === '~~' && textAfter === '~~' && tildeCountAfter % 2 == 0) {
            transaction = { changes: [{ from: { line: cursor.line, ch: cursor.ch - 2 }, to: { line: cursor.line, ch: cursor.ch + 3 }, text: `${char}` }] };
        } else if (tildeCountBefore % 2 === 1 && firstClosingTildePos !== -1) {
            const potentialBlock = lineText.substring(lastOpeningTildePos, firstClosingTildePos + 2);
            if ((potentialBlock.match(/~~/g) || []).length === 2) { editor.setCursor({ line: cursor.line, ch: firstClosingTildePos + 2 }); return true; }
            return true;
        } else if (textBefore === '~~') {
            transaction = { changes: [{ from: { line: cursor.line, ch: cursor.ch - 2 }, to: toPos, text: `${char}~~` }], selection: { from: { line: cursor.line, ch: cursor.ch + 1 } } };
        } else if (textAfter === '~~') {
            transaction = { changes: [{ from: fromPos, to: { line: cursor.line, ch: cursor.ch + 3 }, text: `~~${char}` }], selection: { from: cursor } };
        } else {
            transaction = { changes: [{ from: fromPos, to: toPos, text: `~~${char}~~` }], selection: { from: { line: cursor.line, ch: cursor.ch + 5 } } };
        }
        editor.transaction(transaction);
        return true;
    }
}