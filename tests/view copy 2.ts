import { ItemView, WorkspaceLeaf, TFile, Editor, Menu } from 'obsidian';
import { TextMarker } from 'codemirror';
import type StrikethroughOnKeyPlugin from './main';

// ... (Interface, ANNOTATION_VIEW_TYPE, and the top part of the class are unchanged) ...
export interface Annotation {
    id: string;
    filePath: string;
    line: number;
    ch: number;
    endLine?: number;
    endCh?: number;
    text: string;
}

export const ANNOTATION_VIEW_TYPE = "annotation-view";

export class AnnotationView extends ItemView {
    plugin: StrikethroughOnKeyPlugin;
    private notesContainer: HTMLElement;
    private activeMarker: TextMarker | null = null;
    private activeLine: number | null = null;
    private highlightTimeout: number | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: StrikethroughOnKeyPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.icon = "pencil";
    }

    getViewType(): string { return ANNOTATION_VIEW_TYPE; }
    getDisplayText(): string { return "Annotations"; }

    protected async onOpen(): Promise<void> {
        const viewContent = this.containerEl.children[1];
        viewContent.empty();
        viewContent.addClass("annotation-view-content");
        viewContent.createEl("h4", { text: "Annotations" });
        this.notesContainer = viewContent.createEl("div", { cls: "notes-container" });
        this.registerEvent(this.app.workspace.on('file-open', () => this.redraw()));
        this.redraw();
    }
    
    redraw() {
        if (!this.notesContainer) return;
        this.notesContainer.empty();
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            this.notesContainer.createEl("div", { cls: "empty-annotation-message", text: "No active file." });
            return;
        }
        const fileAnnotations = this.plugin.getAnnotationsForFile(activeFile.path);
        if (fileAnnotations.length === 0) {
            this.notesContainer.createEl("div", { cls: "empty-annotation-message", text: "No annotations for this file yet." });
        } else {
             fileAnnotations.sort((a, b) => a.line - b.line || a.ch - b.ch)
                .forEach(annotation => this.renderAnnotation(annotation, this.notesContainer));
        }
    }
    
    renderAnnotation(annotation: Annotation, container: HTMLElement) {
        const annotationEl = container.createEl("div", { cls: "annotation-item" });
        const textEl = annotationEl.createEl("div", { cls: "annotation-text", text: annotation.text });
        textEl.setAttribute('title', `Line ${annotation.line + 1} - Go to location`);
        textEl.addEventListener('click', () => this.navigateToAndHighlight(annotation));
        const deleteBtn = annotationEl.createEl("button", { cls: "annotation-delete-btn", text: "X", title: "Delete Annotation" });
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.plugin.deleteAnnotation(annotation.id, annotation.filePath);
        });
    }

    // --------------------------------//
    // --- MODIFIED HIGHLIGHT LOGIC ---//
    // --------------------------------//
    async navigateToAndHighlight(annotation: Annotation) {
        // Step 1: Navigate to the file. This also handles scrolling.
        await this.app.workspace.openLinkText(annotation.filePath, '', false, {
            eState: { line: annotation.line }
        });

        // Step 2: Use setTimeout to ensure the editor is ready.
        setTimeout(() => {
            const editor = this.app.workspace.activeEditor?.editor;
            if (!editor) return;

            // Step 3: Clear any *previous* temporary highlights.
            this.clearHighlights();

            const cm = (editor as any).cm;
            if (!cm) return;

            const isSelection = annotation.endLine !== undefined && annotation.endCh !== undefined;

            if (isSelection) {
                // --- CASE: Selection Annotation (e.g., ==text==) ---
                // The text is already permanently highlighted in the document.
                // We just need to move the cursor there. No temporary highlight is needed.
                const fromPos = { line: annotation.line, ch: annotation.ch };
                editor.setCursor(fromPos);

                // We can also ensure the full selection is visible.
                const toPos = { line: annotation.endLine!, ch: annotation.endCh! };
                editor.scrollIntoView({ from: fromPos, to: toPos }, true);

            } else {
                // --- CASE: Insertion Annotation ---
                // No permanent marker exists, so we create a temporary one.
                const pos = { line: annotation.line, ch: annotation.ch };
                editor.setCursor(pos);

                // Add the temporary line highlight.
                cm.addLineClass(annotation.line, 'wrap', 'temp-line-highlight');
                this.activeLine = annotation.line;

                // Set a timeout to clear THIS temporary highlight.
                this.highlightTimeout = window.setTimeout(() => this.clearHighlights(), 2500);
            }
        }, 100);
    }

    clearHighlights() {
        if (this.highlightTimeout) window.clearTimeout(this.highlightTimeout);
        
        // This will now only ever be used for insertion annotations.
        const editor = this.app.workspace.activeEditor?.editor;
        const cm = editor ? (editor as any).cm : null;
        if (cm && this.activeLine !== null) {
            cm.removeLineClass(this.activeLine, 'wrap', 'temp-line-highlight');
        }

        // Reset state
        this.activeMarker = null; // We aren't using this anymore, but good to keep it clean.
        this.activeLine = null;
        this.highlightTimeout = null;
    }
    
    // ... (createNewAnnotationInput is unchanged) ...
    createNewAnnotationInput(annotationData: Omit<Annotation, 'text'>, initialChar: string) {
        this.redraw();
        const emptyMessage = this.notesContainer.querySelector(".empty-annotation-message");
        if (emptyMessage) emptyMessage.remove();
        const inputEl = document.createElement("textarea");
        inputEl.addClass("annotation-input");
        inputEl.placeholder = `Annotation for L${annotationData.line + 1}`;
        inputEl.value = initialChar;
        const saveAnnotation = () => {
            inputEl.remove();
            const text = inputEl.value.trim();
            if (text) {
                this.plugin.addAnnotation({ ...annotationData, text });
            }
        };
        inputEl.addEventListener("blur", saveAnnotation);
        inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); inputEl.blur(); }
            if (e.key === "Escape") { e.preventDefault(); inputEl.remove(); }
        });
        this.notesContainer.prepend(inputEl);
        inputEl.focus();
        inputEl.selectionStart = inputEl.selectionEnd = inputEl.value.length;
    }
}