import { ItemView, WorkspaceLeaf, MarkdownView, Notice } from "obsidian";
import StrikethroughOnKeyPlugin from "./main";
import { ANNOTATION_VIEW_TYPE, Annotation } from "./types";

export class AnnotationView extends ItemView {
    plugin: StrikethroughOnKeyPlugin;
    private newAnnotationData: Partial<Annotation> | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: StrikethroughOnKeyPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() {
        return ANNOTATION_VIEW_TYPE;
    }

    getDisplayText() {
        return "Annotations";
    }

    getIcon() {
        return "strikethrough";
    }

    async onOpen() {
        const container = this.contentEl;
        container.empty();
        const header = container.createEl("div", { cls: "annotation-view-header" });
        header.createEl("h4", { text: "Permanent Ink Annotations" });
        this.draw();

        this.registerEvent(this.app.workspace.on('file-open', () => this.draw()));
        this.registerEvent(this.app.workspace.on('layout-change', () => this.draw()));
    }

    async onClose() {
        // Nothing to clean up.
    }

    public startNewAnnotation(data: Partial<Annotation>) {
        // If another annotation is in progress, cancel it.
        if (this.newAnnotationData && this.newAnnotationData.marker) {
            this.newAnnotationData.marker.clear();
        }
        this.newAnnotationData = data;
        this.draw();

        // Focus the input box after it has been rendered.
        setTimeout(() => {
            const inputEl = this.contentEl.querySelector<HTMLTextAreaElement>('.new-annotation-input');
            if (inputEl) {
                inputEl.focus();
                // Place cursor at the end of the pre-filled text
                inputEl.selectionStart = inputEl.selectionEnd = inputEl.value.length;
            }
        }, 50);
    }

    private renderNewAnnotationInput(container: HTMLElement, data: Partial<Annotation>) {
        const formEl = container.createDiv({ cls: 'new-annotation-form' });
        
        let labelText = data.annotated ? `On "${data.annotated}":` : `Insertion note:`;
        formEl.createEl('label', { text: labelText });
    
        const inputEl = formEl.createEl('textarea', {
            cls: 'new-annotation-input',
            text: data.inserted // Pre-fill with the typed character
        });
        inputEl.rows = 3;
    
        const buttonContainer = formEl.createDiv({ cls: 'new-annotation-buttons' });
        
        const saveButton = buttonContainer.createEl('button', { text: 'Save', cls: 'mod-cta' });
        saveButton.onClickEvent(() => {
            if (!this.newAnnotationData || !this.newAnnotationData.marker || !this.newAnnotationData.id || !this.newAnnotationData.filePath) {
                new Notice("Could not save annotation. Context was lost.");
                this.newAnnotationData?.marker?.clear(); // Clean up marker if it exists
                this.newAnnotationData = null;
                this.draw();
                return;
            }
            
            const finalAnnotation: Annotation = {
                id: this.newAnnotationData.id,
                filePath: this.newAnnotationData.filePath,
                marker: this.newAnnotationData.marker,
                inserted: inputEl.value,
                annotated: this.newAnnotationData.annotated || null,
            };
    
            this.plugin.addAnnotation(finalAnnotation);
    
            this.newAnnotationData = null;
            this.draw();
        });
    
        const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelButton.onClickEvent(() => {
            if (this.newAnnotationData && this.newAnnotationData.marker) {
                this.newAnnotationData.marker.clear();
            }
            this.newAnnotationData = null;
            this.draw();
        });
    }

    draw() {
        const container = this.contentEl;
        let contentEl = container.querySelector<HTMLElement>('.permanent-ink-annotations-container');
        if (!contentEl) {
            contentEl = container.createDiv({ cls: 'permanent-ink-annotations-container' });
        }
        contentEl.empty();

        // --- Render the new annotation input box if we are creating one ---
        if (this.newAnnotationData) {
            this.renderNewAnnotationInput(contentEl, this.newAnnotationData);
            contentEl.createEl("hr");
        }
        
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            if (!this.newAnnotationData) {
                contentEl.createEl("p", { text: "Open a file to see annotations.", cls: "annotation-empty-state" });
            }
            return;
        }
        
        const annotations = this.plugin.getAnnotationsForFile(activeFile.path);

        if (annotations.length === 0 && !this.newAnnotationData) {
            contentEl.createEl("p", { text: "No annotations in this file.", cls: "annotation-empty-state" });
            return;
        }

        for (const annotation of annotations) {
            const entry = contentEl.createDiv({ cls: 'annotation-entry' });
            let displayHtml: string;
            if (annotation.annotated) {
                // Using innerHTML to render the parts differently
                displayHtml = `On "<em>${this.escapeHtml(annotation.annotated)}</em>": ${this.escapeHtml(annotation.inserted)}`;
            } else {
                displayHtml = `Insertion: <strong>"${this.escapeHtml(annotation.inserted)}"</strong>`;
            }
            entry.createEl("p").innerHTML = displayHtml;
            
            entry.addEventListener('click', () => {
                const pos = annotation.marker.find();
                if (pos) {
                    const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
                    if (editor) {
                        const from = 'from' in pos ? pos.from : pos;
                        const to = 'to' in pos ? pos.to : pos;
                        editor.setCursor(from);
                        editor.scrollIntoView({ from, to }, true);
                    }
                }
            });
        }
    }

    private escapeHtml(text: string): string {
        return text
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }
}
