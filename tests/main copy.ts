import { Plugin, Editor, Notice, MarkdownView, EditorTransaction, EditorPosition, EditorCommandName } from 'obsidian';


export default class StrikethroughOnKeyPlugin extends Plugin {

    // This will hold the reference to our status bar element.
    private statusBarItem: HTMLElement;
    // This is the master switch for the plugin's functionality.
    private isEnabled: boolean = true;

    // --- List of characters that can terminate an auto-paired block ---
    private readonly closingChars = [')', ']', '}', '"', "'", '`', '*','**', '_', '$'];

    async onload() {
        console.log('Loading Smart Strikethrough plugin');

        // --- Create and manage the status bar item ---
        this.statusBarItem = this.addStatusBarItem();
        // Add a click listener to toggle the plugin's state.
        this.statusBarItem.addEventListener('click', () => {
            this.isEnabled = !this.isEnabled; // Flip the switch
            this.updateStatusBar(); // Update the text and style
            console.log(`Smart Strikethrough is now ${this.isEnabled ? 'ENABLED' : 'DISABLED'}`);
        });

        // <<< NEW/UPDATED: Defer ribbon icon creation >>>
        // This waits until the workspace layout is ready, ensuring the icon
        // is added after the core Obsidian icons and those from other plugins.
        this.app.workspace.onLayoutReady(() => {
            this.addRibbonIcon('strikethrough', 'Toggle Permanent Ink', (evt: MouseEvent) => {
                this.togglePluginState();
            });
        });


        // Set the initial appearance of the status bar item.
        this.updateStatusBar();

        this.registerDomEvent(
            this.app.workspace.containerEl,
            'keydown',
            (evt: KeyboardEvent) => {

                // If the plugin is disabled via the status bar, do nothing.
                if (!this.isEnabled) {
                    return;
                }


                const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (!view) return;
                const editor = view.editor;


                // --- FEATURE 1: PREVENT UNDO & CUT ---
                // Intercept Ctrl+Z/X (or Cmd+Z/X on Mac) and prevent the default actions.
                // This is a core part of the plugin's "destructive" editing style.
                if ((evt.ctrlKey || evt.metaKey) && !evt.shiftKey) { // Shift is allowed for "Redo"
                    const key = evt.key.toLowerCase();
                    if (key === 'z') {
                        console.log("Undo action prevented by plugin.");
                        evt.preventDefault();
                        evt.stopPropagation();
                        return;
                    }
                    // --- Block Ctrl+X (Cut) ---
                    if (key === 'x') {
                        console.log("Cut action prevented by plugin.");
                        evt.preventDefault();
                        evt.stopPropagation();
                        return;
                    }
                }

                // --- PREVENT CREATING NEW LINES IN THE MIDDLE OF THE DOCUMENT ---
                if (evt.key === 'Enter') {
                    const cursor = editor.getCursor();
                    const lastLineNum = editor.lastLine();

                    // If we are NOT on the last line of the document...
                    if (cursor.line < lastLineNum) {
                        const nextLine = editor.getLine(cursor.line + 1);
                        if (nextLine.trim() !== '' || nextLine.trim() === '') {
                            // ...then prevent creating a new line.
                            console.log("Prevented creating newline in middle of document.");
                            evt.preventDefault();
                            evt.stopPropagation();
                            return; // Action handled.
                        }
                    }
                    // If we are on the last line, OR the line below is empty,
                    // we allow the 'Enter' key to proceed. It will fall through to the
                    // "jump-to-end" logic below to ensure it's positioned correctly.
                }

                // --- FEATURE 2: PREVENT MID-LINE INSERTION ---
                // This logic forces all typing, pasting, and new lines to occur at the end of the current line.
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

                // // --- PREVENT VISUAL LINE WRAP ON "FULL" LINES ---
                // // This prevents adding more text to a line that has already reached the
                // // "readable line length," which would cause a visual wrap.
                // // This check is ignored for the very last line of the document.
                // if (!isNavigationOrModifier && evt.key !== 'Backspace' && evt.key !== 'Delete' && !editor.somethingSelected()) {
                //     const cursor = editor.getCursor();
                //     const lastLineNum = editor.lastLine();

                //     // Only apply this restriction to lines that are NOT the last line.
                //     if (cursor.line < lastLineNum) {
                //         const useReadableLength = (this.app.vault as any).getConfig('readableLineLength');
                        
                //         // If the "Readable line length" setting is active...
                //         if (useReadableLength) {
                //             // Get the character limit, with a sensible fallback.
                //             const readableWidth = (this.app.vault as any).getConfig('line-width') || 80;
                //             const line = editor.getLine(cursor.line);

                //             // If the line is already at or over the limit and the cursor is at the end...
                //             if (line.length >= readableWidth && cursor.ch === line.length) {
                //                 console.log("Prevented typing on a full line to avoid visual wrap.");
                //                 evt.preventDefault();
                //                 evt.stopPropagation();
                //                 return; // Action handled.
                //             }
                //         }
                //     }
                // }                 

                
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

                // --- FEATURE 3: Smart Strikethrough Logic ---

                // --- Standard handling for non-composing state ---
                if (evt.key !== 'Backspace' && evt.key !== 'Delete') {
                    return;
                }
                // // And prevent the strikethrough logic if any modifier key is also pressed.
                // if (evt.ctrlKey || evt.altKey || evt.shiftKey || evt.metaKey) {
                //     return;
                // }

                let handled = false;
                if (evt.key === 'Backspace') {
                    handled = this.handleBackspaceAction(editor);
                } else if (evt.key === 'Delete') {
                    handled = this.handleDeleteAction(editor);
                }

                // If our custom logic handled the event, prevent the default Backspace/Delete action.
                if (handled) {
                    evt.preventDefault();
                    evt.stopPropagation();
                }
                
            },
            true // Use the capturing phase to intercept the event early.
        );

     

    }
    

    onunload() {
        console.log('Unloading Smart Strikethrough plugin');
        // Clean up the status bar item when the plugin is disabled.
        this.statusBarItem?.remove();
    }

    /**
     * Toggles the enabled state of the plugin and updates the UI.
     */
    private togglePluginState(): void {
        this.isEnabled = !this.isEnabled;
        this.updateStatusBar();

        // <<< NEW: Create a notice to inform the user of the state change >>>
        new Notice(`Permanent Ink is now ${this.isEnabled ? 'ON' : 'OFF'}`);

        console.log(`Permanent Ink is now ${this.isEnabled ? 'ENABLED' : 'DISABLED'}`);
    }


    // --- A helper function to update the status bar's appearance ---
    private updateStatusBar(): void {
        if (!this.statusBarItem) return;

        if (this.isEnabled) {
            this.statusBarItem.setText('Permanent Ink: ON');
            // Using a CSS class is better for theming.
            this.statusBarItem.removeClass('is-inactive');
            this.statusBarItem.addClass('is-active');
            this.statusBarItem.setAttribute('title', 'Permanent Ink is ON. Click to disable.');
        } else {
            this.statusBarItem.setText('Permanent Ink: OFF');
            this.statusBarItem.removeClass('is-active');
            this.statusBarItem.addClass('is-inactive');
            this.statusBarItem.setAttribute('title', 'Permanent Ink is OFF. Click to enable.');
        }
    }

    /**
     * Helper function to count '~~' occurrences.
     */
    private countTildes(s: string): number {
        return (s.match(/~~/g) || []).length;
    }

    /**
     * Processes a single line of a selection based on a set of logical rules.
     * @returns The entire processed line as a string.
     */
    private processLine(editor: Editor, lineNumber: number, startCh: number, endCh: number): string {
        const fullLineText = editor.getLine(lineNumber);
        let lineSelection = fullLineText.substring(startCh, endCh);

        // --- RULE 1: SMART SELECTION EXPANSION (for this line) ---
        if (lineSelection.startsWith('~') && !lineSelection.startsWith('~~') && startCh > 0) {
            if (fullLineText.charAt(startCh - 1) === '~') {
                startCh--;
            }
        }
        if (lineSelection.endsWith('~') && !lineSelection.endsWith('~~')) {
            if (fullLineText.charAt(endCh) === '~') {
                endCh++;
            }
        }
        lineSelection = fullLineText.substring(startCh, endCh);
        
        // After potential expansion, get the final context.
        const textBefore = fullLineText.substring(0, startCh);
        const textAfter = fullLineText.substring(endCh);
        const tildesInSelection = this.countTildes(lineSelection);
        const tildesBefore = this.countTildes(textBefore);
        const tildesAfter = this.countTildes(textAfter);
        const cleanedSelection = lineSelection.replace(/~~/g, '');

        if (tildesInSelection === 0 && tildesBefore % 2 === 1) {
            return textBefore + lineSelection + textAfter;
        }

        // --- RULE 2: EVEN `~~` IN SELECTION ---
        if (tildesInSelection > 0 && tildesInSelection % 2 === 0) {
            // RULE 2a: Merging/Joining adjacent strikethrough blocks.
            // Context: ~~a~~ [sel] ~~b~~
            if (tildesBefore % 2 === 0 && tildesAfter % 2 === 0) {
                const isBefore = textBefore.endsWith('~~');
                const isAfter = textAfter.startsWith('~~');

                // Re-wrap the cleaned selection
                if (lineSelection.startsWith('~~') || lineSelection.endsWith('~~') && !isBefore && !isAfter) {
                    return textBefore + '~~' + cleanedSelection + '~~' + textAfter;
                }
                if (isBefore && isAfter) { // Merge all: ~~ [sel] ~~ -> [sel]
                    return textBefore.slice(0, -2) + cleanedSelection + textAfter.slice(2);
                }
                if (isBefore) { // Consume before, move end: ~~ [sel] -> [sel]~~
                    return textBefore.slice(0, -2) + cleanedSelection + '~~' + textAfter;
                }
                if (isAfter) { // Consume after, move start: [sel] ~~ -> ~~[sel]
                    return textBefore + '~~' + cleanedSelection + textAfter.slice(2);
                }

                // Re-wrap the cleaned selection if it was already fully wrapped.
                if (lineSelection.startsWith('~~') && lineSelection.endsWith('~~')) {
                    return textBefore + '~~' + cleanedSelection + '~~' + textAfter;
                }
            }
            // RULE 2b: Unwrapping content from within a single strikethrough block.
            // Context: ~~a [sel] b~~
            else if (tildesBefore % 2 === 1 && tildesAfter % 2 === 1) {
                return textBefore + cleanedSelection + textAfter;
            }
        }

        // --- RULE 3: ODD `~~` IN SELECTION ---
        if (tildesInSelection % 2 === 1) {
            // RULE 3a: Canceling out or starting a new strikethrough.
            if (tildesBefore % 2 === 0) {
                if (textBefore.endsWith('~~')) { // Cancel out with preceding ~~
                    return textBefore.slice(0, -2) + cleanedSelection + textAfter;
                }
                if (textAfter.startsWith('~~')) { // Cancel out with succeeding ~~
                    return textBefore + cleanedSelection + textAfter.slice(2);
                }
                // Fallback: Default opening action
                return textBefore + '~~' + cleanedSelection + textAfter;
            }
            // RULE 3b: Completing an existing strikethrough.
            else {
                if (textAfter.startsWith('~~')){
                    return textBefore + cleanedSelection + textAfter.slice(2);
                }
                else {
                return textBefore + cleanedSelection + '~~' + textAfter;
                }
            }
        }

        // --- DEFAULT BEHAVIOR: SIMPLE WRAP/UNWRAP TOGGLE ---
        // If no special rules matched, this is the most basic action.
        if (this.countTildes(lineSelection) > 0) {
            // If it has tildes, unwrap it.
            return textBefore + '~~' + cleanedSelection + '~~' + textAfter;
        } else {
            // If it has no tildes, wrap it.
            return textBefore + '~~' + lineSelection + '~~' + textAfter;
        }
    }

    /**
     * Main handler for selections, processing each line individually.
     */
    private handleSelection(editor: Editor): boolean {
        if (!editor.somethingSelected()) {
            return false;
        }
    
        const from = editor.getCursor('from');
        const to = editor.getCursor('to');
        const processedLines: string[] = [];
    
        // Iterate through each line in the selection.
        for (let i = from.line; i <= to.line; i++) {
            // Determine the start and end character positions for the selection on this specific line.
            const fullLineText = editor.getLine(i);
            let startCh = (i === from.line) ? from.ch : 0;
            let endCh = (i === to.line) ? to.ch : fullLineText.length;

            // --- Adjust startCh to skip leading whitespace within the selection on this line ---
            while (startCh < endCh && /\s/.test(fullLineText.charAt(startCh))) {
                startCh++;
            }
            // --- Adjust endCh to skip trailing whitespace within the selection on this line ---
            while (endCh > startCh && /\s/.test(fullLineText.charAt(endCh - 1))) {
                endCh--;
            }
    
            // If the selection on this line is now empty (e.g., was only whitespace),
            // just keep the original line and continue.
            if (startCh >= endCh) {
                processedLines.push(fullLineText);
                continue;
            }

    
            // Process the line using the dedicated logic function.
            const newLine = this.processLine(editor, i, startCh, endCh);
            processedLines.push(newLine);
        }
    
        // Replace the original selection range with the newly processed lines.
        editor.replaceRange(processedLines.join('\n'), {line: from.line, ch: 0}, {line: to.line, ch: editor.getLine(to.line).length});
        
        return true;
    }

    /**
     * Implements the custom Backspace logic.
     * @param editor The active editor instance.
     * @returns `true` if the event was handled, `false` to allow default behavior.
     */
    private handleBackspaceAction(editor: Editor): boolean {
        // If there's a selection, the dedicated handler takes precedence.
        if (this.handleSelection(editor)) {
            return true;
        }
    
        const cursor = editor.getCursor();
        const lineText = editor.getLine(cursor.line);
    
        // --- PREVENT DELETING EMPTY LINES ---
        // If the current line is blank, do nothing on Backspace.
        if (lineText.trim() === '') {
            return true; // Handled by preventing action.
        }
        // If at the start of a line, prevent merging with a blank line above.
        if (cursor.ch === 0 && cursor.line > 0) {
            const lineAbove = editor.getLine(cursor.line - 1);
            if (lineAbove.trim() === '') {
                return true; // Handled by preventing action.
            }
        }
    
        // At the very start of the document, allow default behavior (which is nothing).
        if (cursor.line === 0 && cursor.ch === 0) return false;
    
        const fromPos = { line: cursor.line, ch: cursor.ch - 1 };
        const toPos = cursor;
        const char = editor.getRange(fromPos, toPos);
    
        if (!char || char === '\n') {
            return true; // Prevent merging non-empty lines
        }
    
        // Instead of deleting a space, just move the cursor left.
        if (char === ' ') {
            editor.setCursor({ line: cursor.line, ch: cursor.ch - 1 });
            return true;
        }

        // Handles the case where the cursor is at the end of a block, like `~~text~~|`.
        // Pressing Backspace should move the cursor to the front: `|~~text~~`.
        if (cursor.ch > 1 && lineText.substring(cursor.ch - 2, cursor.ch) === '~~') {
            // Find the position of the matching opening `~~` for this block.
            // We search in the part of the string *before* the closing `~~`.
            const searchArea = lineText.substring(0, cursor.ch - 2);
            const openingTildePos = searchArea.lastIndexOf('~~');
            
            // To be considered a valid, simple block, the number of `~~` markers between
            // the opening and closing should be odd (just the opening one).
            if (openingTildePos !== -1) {
                const blockContent = searchArea.substring(openingTildePos);
                const tildeCountInBlock = (blockContent.match(/~~/g) || []).length;
                
                if (tildeCountInBlock % 2 === 1) {
                    editor.setCursor({ line: cursor.line, ch: openingTildePos });
                    return true; // Event handled.
                }
            }
        }

        // Prevent deleting the tilde characters themselves in other contexts.
        if (char === '~') {
            return true;
        }

        let transaction: EditorTransaction;
        // Check the text immediately surrounding the character to be deleted.
        const textAfter = editor.getRange(cursor, { line: cursor.line, ch: cursor.ch + 2 });
        const textBefore = cursor.ch >= 3 ? editor.getRange({ line: cursor.line, ch: cursor.ch - 3 }, fromPos) : '';

        // For more complex logic, we need context from the entire line.
        const textBeforeCursorOnLine = lineText.substring(0, cursor.ch);
        const textAfterCursorOnLine = lineText.substring(cursor.ch);
        const tildeCountBefore = (textBeforeCursorOnLine.match(/~~/g) || []).length;
        const tildeCountAfter  = (textAfterCursorOnLine.match(/~~/g) || []).length;
    
        const lastOpeningTildePos = textBeforeCursorOnLine.lastIndexOf('~~');
        const firstClosingTildePos = textAfterCursorOnLine.indexOf('~~');

        // Case: Un-strikethrough a single character between 2 blocks to merge all into one block.
        // e.g., hitting backspace in `~~x~~c|~~y~~` unwraps it to `~~xcy~~`.
        if (textBefore === '~~' && textAfter === '~~' && tildeCountAfter % 2 == 0) {
            transaction = { changes: [{ from: { line: cursor.line, ch: cursor.ch - 3 }, to: { line: cursor.line, ch: cursor.ch + 2 }, text: `${char}` }]};
        
        // Case: Cursor is inside a valid strikethrough block, like `~~so|me text~~`.
        } else if (tildeCountBefore % 2 === 1 && tildeCountAfter > 0) {
            // To ensure we're in a simple `~~...~~` block, we check if there are other `~~` markers between
            // the nearest opening one and the nearest closing one.
            const fullClosingTildePos = cursor.ch + firstClosingTildePos;
            const potentialBlock = lineText.substring(lastOpeningTildePos, fullClosingTildePos + 2);
            const tildeCountInBlock = (potentialBlock.match(/~~/g) || []).length;
    
            // If it's a simple block (one opening `~~`, one closing `~~`)...
            if (tildeCountInBlock === 2) {
                // ...then backspacing moves the cursor to the beginning of the block instead of deleting a character.
                editor.setCursor({ line: cursor.line, ch: lastOpeningTildePos });
                return true; // Event handled.
            }
            // If it's a complex/nested block (e.g., `~~a~~b|~~`), do nothing to avoid unpredictable behavior.
            return true;
        
        // Case: Move the opening `~~` marker rightwards. e.g., backspacing on 'c' in `~~c|` becomes `c~~|`.
        } else if (textBefore === '~~') {
            transaction = { changes: [{ from: { line: cursor.line, ch: cursor.ch - 3 }, to: cursor, text: `${char}~~` }] };
        
        // Case: Move the closing `~~` marker leftwards. e.g., backspacing on 'c' in `c|~~` becomes `~~c|`.
        } else if (textAfter === '~~') {
            transaction = { changes: [{ from: fromPos, to: { line: cursor.line, ch: cursor.ch + 2 }, text: `~~${char}` }], selection: { from: fromPos } };
        
        // Default Case: Strikethrough the character to the left of the cursor. e.g., `c|` becomes `~~c~~|`.
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
    private handleDeleteAction(editor: Editor): boolean {
        // If there's a selection, the dedicated handler takes precedence.
        if (this.handleSelection(editor)) {
            return true;
        }

        const cursor = editor.getCursor();
        const lineText = editor.getLine(cursor.line);

        // --- PREVENT DELETING EMPTY LINES (SYMMETRICAL TO BACKSPACE) ---
        // Case 1: The current line itself is blank.
        if (lineText.trim() === '') {
            return true; // Handled by preventing action.
        }
        // Case 2: Cursor is at the end of a line, and the line below is blank.
        if (cursor.ch === lineText.length && cursor.line < editor.lastLine()) {
            const lineBelow = editor.getLine(cursor.line + 1);
            if (lineBelow.trim() === '') {
                // Prevent deleting the newline to merge with a blank line.
                return true; // Handled by preventing action.
            }
        }
        
        // At the very end of the document, allow default behavior.
        if (cursor.ch === lineText.length && cursor.line === editor.lastLine()) {
            return false;
        }

        const fromPos = cursor;
        const toPos = { line: cursor.line, ch: cursor.ch + 1 };
        const char = editor.getRange(fromPos, toPos);

        if (!char || char === '\n') {
            return true; // Prevent merging non-empty lines
        }

        // Instead of deleting a space, just move the cursor right.
        if (char === ' ') {
            editor.setCursor({ line: cursor.line, ch: cursor.ch + 1 });
            return true;
        }

        // Handles the case where the cursor is at the start of a block: `|~~text~~`.
        // Pressing Delete should move the cursor to the end: `~~text~~|`.
        if (cursor.ch < lineText.length - 1 && lineText.substring(cursor.ch, cursor.ch + 2) === '~~') {
            // Find the position of the matching closing `~~` for this block.
            // We search in the part of the string *after* the opening `~~`.
            const searchArea = lineText.substring(cursor.ch + 2);
            const closingTildePosInSearchArea = searchArea.indexOf('~~');
            
            // If a closing `~~` is found...
            if (closingTildePosInSearchArea !== -1) {
                // ...calculate its absolute position on the line.
                const absoluteClosingTildePos = cursor.ch + 2 + closingTildePosInSearchArea;

                // To ensure it's a simple block, we check the number of `~~` markers within it.
                // It should be exactly 2: the one at the start and the one at the end.
                const potentialBlock = lineText.substring(cursor.ch, absoluteClosingTildePos + 2);
                const tildeCountInBlock = (potentialBlock.match(/~~/g) || []).length;

                if (tildeCountInBlock === 2) {
                    // Move the cursor to the end of the block.
                    editor.setCursor({ line: cursor.line, ch: absoluteClosingTildePos + 2 });
                    return true; // Event handled.
                }
            }
        }
        
        // Prevent deleting the tilde characters themselves.
        if (char === '~') {
            return true;
        }

        let transaction: EditorTransaction;
        // Check the text immediately surrounding the character to be deleted.
        const textAfter = editor.getRange(toPos, { line: toPos.line, ch: toPos.ch + 2 });
        const textBefore = cursor.ch >= 2 ? editor.getRange({ line: cursor.line, ch: cursor.ch - 2 }, cursor) : '';
        
        // For more complex logic, we need context from the entire line.
        const textBeforeCursorOnLine = lineText.substring(0, cursor.ch);
        const textAfterCursorOnLine = lineText.substring(cursor.ch);
        const tildeCountBefore = (textBeforeCursorOnLine.match(/~~/g) || []).length;
        const tildeCountAfter  = (textAfterCursorOnLine.substring(1).match(/~~/g) || []).length;

        const lastOpeningTildePos = textBeforeCursorOnLine.lastIndexOf('~~');
        const firstClosingTildePosInAfter = textAfterCursorOnLine.indexOf('~~');
        const firstClosingTildePos = (firstClosingTildePosInAfter !== -1) ? cursor.ch + firstClosingTildePosInAfter : -1;

        // Case: Un-strikethrough a single character between 2 blocks to merge all into one block.
        // e.g., hitting delete in `~~x~~|c~~y~~` unwraps it to `~~xcy~~`.
        if (textBefore === '~~' && textAfter === '~~' && tildeCountAfter % 2 == 0) {
            transaction = { changes: [{ from: { line: cursor.line, ch: cursor.ch - 2 }, to: { line: cursor.line, ch: cursor.ch + 3 }, text: `${char}` }]};
        
        // Case: Cursor is inside a valid strikethrough block, like `~~so|me text~~`.
        } else if (tildeCountBefore % 2 === 1 && firstClosingTildePos !== -1) {
            // Symmetrical to the Backspace handler, we find the containing block.
            const potentialBlock = lineText.substring(lastOpeningTildePos, firstClosingTildePos + 2);
            const tildeCountInBlock = (potentialBlock.match(/~~/g) || []).length;

            // If it's a simple block...
            if (tildeCountInBlock === 2) {
                // ...then deleting moves the cursor to the end of the block instead of deleting a character.
                editor.setCursor({ line: cursor.line, ch: firstClosingTildePos + 2 });
                return true; // Event handled.
            }
            // If it's a complex/nested block, do nothing to avoid unpredictable behavior.
            return true;

        // Case: Move the opening `~~` marker rightwards. e.g., deleting on 'c' in `~~|c` becomes `c~~|`.
        } else if (textBefore === '~~') {
            transaction = {
                changes: [{ from: { line: cursor.line, ch: cursor.ch - 2 }, to: toPos , text: `${char}~~` }],
                selection: { from: { line: cursor.line, ch: cursor.ch + 1 } } // Cursor after 'c': c|~~
            };

        // Case: Move the closing `~~` marker leftwards. e.g., deleting on 'c' in `|c~~` becomes `|~~c`.
        } else if (textAfter === '~~') {
            transaction = { 
                changes: [{ from: fromPos, to: { line: cursor.line, ch: cursor.ch + 3 }, text: `~~${char}` }], 
                selection: { from: cursor } // Cursor before markers: |~~c
            };
        
        // Default Case: Strikethrough the character to the right of the cursor. e.g., `|c` becomes `~~c~~|`.
        } else {
            transaction = { 
                changes: [{ from: fromPos, to: toPos, text: `~~${char}~~` }], 
                selection: { from: {line: cursor.line, ch: cursor.ch + 5} } // Cursor at the end: ~~c~~|
            };
        }
        
        editor.transaction(transaction);
        return true;
    }
}