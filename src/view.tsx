import { ItemView, WorkspaceLeaf, type Editor } from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import { type EditorView } from "@codemirror/view";
import { useState, useEffect, useRef } from "react";
import { setIcon } from "obsidian";

export const OMNIDIAN_ANNOTATIONS_VIEW_TYPE = "omnidian-annotations-view";

export interface Annotation {
	type: 'highlight' | 'strikethrough';
	text: string;
	comment: string;
	line: number;
	color: string | null;
	from: number;
	to: number;
}

interface EditorWithCm extends Editor {
	cm: EditorView;
}

export class OmnidianAnnotationsView extends ItemView {
	private root: Root | null = null;
	private annotations: Annotation[] = [];
	private associatedEditor: Editor | null = null;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType() { return OMNIDIAN_ANNOTATIONS_VIEW_TYPE; }
	getDisplayText() { return "Annotations"; }
	getIcon() { return "message-square-quote"; }

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		this.root = createRoot(container);
		this.render();
	}

	async onClose() {
		this.root?.unmount();
	}

	public setData(annotations: Annotation[], editor: Editor) {
		this.annotations = annotations;
		this.associatedEditor = editor;
		this.render();
	}

	public clear() {
		this.annotations = [];
		this.associatedEditor = null;
		this.render();
	}

	private render() {
		if (this.root) {
			this.root.render(
				<div className="omnidian-annotations-view">
					<AnnotationsListComponent
						annotations={this.annotations}
						onItemClick={(from, to) => this.jumpToAnnotation(from, to)}
						onCommentUpdate={(from, to, text, type, newComment, color) => 
							this.updateAnnotationComment(from, to, text, type, newComment, color)}
						onItemRemove={(from, to, text) => this.removeAnnotation(from, to, text)}
					/>
				</div>
			);
		}
	}

	private jumpToAnnotation(from: number, to: number) {
		if (!this.associatedEditor) return;
		const editor = this.associatedEditor;
		const editorView = (editor as EditorWithCm).cm;
		editor.focus();
		const endPos = editor.offsetToPos(to);
		editor.scrollIntoView({ from: endPos, to: endPos }, true);
		this.createVisualIndicator(from, to, editorView);
	}
	
	private createVisualIndicator(from: number, to: number, view: EditorView) {
		// Remove any existing indicators to avoid overlap
		document.querySelectorAll('.perink-focus-indicator').forEach(el => el.remove());
	
		const scroller = view.dom.querySelector('.cm-scroller');
		if (!scroller) return;
	
		// Get info about the scroller's position for coordinate conversion
		const scrollerRect = scroller.getBoundingClientRect();
	
		// Use CodeMirror's utility to find the precise DOM node and offset for the start/end of the annotation
		const startDomInfo = view.domAtPos(from);
		const endDomInfo = view.domAtPos(to);
	
		// Create a standard DOM Range object to represent the selection in the browser's DOM
		const range = document.createRange();
		range.setStart(startDomInfo.node, startDomInfo.offset);
		range.setEnd(endDomInfo.node, endDomInfo.offset);
	
		// This is the key: getClientRects() returns a rectangle for each *visual* line the range occupies.
		// This correctly handles text wrapping.
		const rects = range.getClientRects();
	
		for (const rect of Array.from(rects)) {
			if (rect.width < 1) continue;
			
			// For each visual line segment, create a separate indicator div
			const indicator = document.createElement('div');
			indicator.className = 'perink-focus-indicator';
	
			const padding = 4;
	
			// Convert viewport-relative coordinates from the rect to scroller-relative coordinates for positioning
			const top = rect.top - scrollerRect.top + scroller.scrollTop ;//- padding;
			const left = rect.left - scrollerRect.left + scroller.scrollLeft - padding;
			const width = rect.width + (padding * 2);
			const height = rect.height ;//+ (padding * 2);
	
			indicator.style.top = `${top}px`;
			indicator.style.left = `${left}px`;
			indicator.style.width = `${width}px`;
			indicator.style.height = `${height}px`;
	
			indicator.style.backgroundColor = getComputedStyle(scroller).backgroundColor;
			scroller.appendChild(indicator);
	
			// Self-destruct after the animation finishes
			indicator.addEventListener('animationend', () => {
				indicator.remove();
			});
		}
	}

	private updateAnnotationComment(from: number, to: number, text: string, type: 'highlight' | 'strikethrough', newComment: string, color: string | null) {
		if (!this.associatedEditor) return;

		const buildFullComment = (text: string, color: string | null): string => {
			const trimmedText = text.trim();
			const colorString = color ? ` @${color}` : "";
			return (trimmedText ? `${trimmedText}${colorString}` : colorString).trim();
		};

		const fullCommentText = buildFullComment(newComment, type === 'highlight' ? color : null);
		const tag = type === 'highlight' ? '==' : '~~';
		
		const newAnnotation = fullCommentText
			? `${tag}${text}${tag}<!--${fullCommentText}-->`
			: `${tag}${text}${tag}`;
		
		this.associatedEditor.replaceRange(
			newAnnotation, 
			this.associatedEditor.offsetToPos(from), 
			this.associatedEditor.offsetToPos(to)
		);
		
		// Find the annotation in the local state and update it.
		const annotationIndex = this.annotations.findIndex(ann => ann.from === from);
		if (annotationIndex !== -1) {
			this.annotations[annotationIndex].comment = newComment;
			// The 'to' offset will change because the comment length changes.
			this.annotations[annotationIndex].to = from + newAnnotation.length;
		}

		// Force an immediate re-render with the updated data.
		this.render();
	}

	private removeAnnotation(from: number, to: number, text: string) {
		if (!this.associatedEditor) return;
	
		// --- FIX: Manually calculate offset changes to prevent race conditions ---
		const originalLength = to - from;
		const newLength = text.length;
		const offsetDelta = newLength - originalLength;
	
		// Perform the text replacement in the editor
		this.associatedEditor.replaceRange(
			text,
			this.associatedEditor.offsetToPos(from),
			this.associatedEditor.offsetToPos(to)
		);
	
		// Immediately update the offsets of all subsequent annotations.
		const updatedAnnotations = this.annotations
			.filter(ann => ann.from !== from) // Remove the deleted annotation
			.map(ann => {
				if (ann.from > from) {
					// This annotation came *after* the one that was removed, so we adjust its position.
					return {
						...ann,
						from: ann.from + offsetDelta,
						to: ann.to + offsetDelta,
					};
				}
				// This annotation came before, so its position is unchanged.
				return ann;
			});
	
		// Update the component's internal state with the new, correct list.
		this.annotations = updatedAnnotations;
		
		// Force a re-render of the React component with the now-correct data.
		this.render();
	}
}

// React Component for the list of annotations
function AnnotationsListComponent({ annotations, onItemClick, onCommentUpdate, onItemRemove }: { 
    annotations: Annotation[], 
    onItemClick: (from: number, to: number) => void,
    onCommentUpdate: (from: number, to: number, text: string, type: 'highlight' | 'strikethrough', newComment: string, color: string | null) => void,
	onItemRemove: (from: number, to: number, text: string) => void
}) {
    const [editingAnnotationFrom, setEditingAnnotationFrom] = useState<number | null>(null);
    const isSwitchingAnnotation = useRef(false);
 
     const handleCardClick = (annotation: Annotation) => {
        isSwitchingAnnotation.current = true;
		onItemClick(annotation.from, annotation.to);
		setEditingAnnotationFrom(annotation.from);

        setTimeout(() => {
            isSwitchingAnnotation.current = false;
        }, 100);
     };

    const handleSave = (annotation: Annotation, newComment: string) => {
        onCommentUpdate(annotation.from, annotation.to, annotation.text, annotation.type, newComment, annotation.color);
		if (!isSwitchingAnnotation.current) {
			 setEditingAnnotationFrom(null);
		}
    };
	
	if (annotations.length === 0) {
		return <div className="annotation-list-empty"><p>No annotations in the current file.</p></div>;
	}

	return (
		<div className="annotation-list">
			{annotations.map((annotation, index) => {
                if (editingAnnotationFrom === annotation.from) {
                    return (
                        <AnnotationEditComponent 
                            key={`${annotation.from}-${index}-edit`}
                            annotation={annotation}
                            onSave={(newComment) => handleSave(annotation, newComment)}
                            onCancel={() => setEditingAnnotationFrom(null)}
                        />
                    );
                } else {
                    return (
						<div key={`${annotation.from}-${index}`} className="annotation-card" onMouseDown={() => handleCardClick(annotation)}>
							<div className="annotation-card-header">
								<div className="annotation-card-header-content">
									<span className="annotation-type-indicator" style={{ backgroundColor: annotation.type === 'highlight' ? annotation.color ?? 'var(--text-highlight-bg)' : 'var(--text-faint)' }}></span>
									<span className="annotation-category">{annotation.type === 'highlight' ? 'Highlight:' : annotation.comment ? 'Replace:' : 'Delete:'}</span>
									<span className="annotation-text-preview">"{annotation.text}"</span>
								</div>
								<RemoveButton onClick={(e) => {
									e.stopPropagation();
									onItemRemove(annotation.from, annotation.to, annotation.text);
								}} />
							</div>
							{annotation.comment && <div className="annotation-comment-wrapper">
								<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41L18.37 3.29a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
								<span className="annotation-comment">{annotation.comment}</span>
							</div>}
						</div>
                    );
                }
            })}
		</div>
	);
}

// --- Helper Component for the Remove Button ---
function RemoveButton({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
    const btnRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (btnRef.current) {
            setIcon(btnRef.current, "eraser");
        }
    }, []);
    return <button 
		ref={btnRef} 
		onClick={onClick} 
		onMouseDown={(e) => e.stopPropagation()}
		className="annotation-remove-btn clickable-icon" 
		title="Remove annotation"
	/>
}


// React component for the inline editing UI in the sidebar
function AnnotationEditComponent({ annotation, onSave, onCancel }: {
    annotation: Annotation;
    onSave: (newComment: string) => void;
    onCancel: () => void;
}) {
    const [comment, setComment] = useState(annotation.comment);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        setTimeout(() => {
            if (textareaRef.current) {
                textareaRef.current.focus();
                const len = textareaRef.current.value.length;
                textareaRef.current.selectionStart = len;
                textareaRef.current.selectionEnd = len;
            }
        }, 0);
    }, []);

    const handleSave = () => onSave(comment);

    return (
        <div className="annotation-card is-editing">
            <div className="annotation-card-header">
				<span className="annotation-type-indicator" style={{ backgroundColor: annotation.type === 'highlight' ? annotation.color ?? 'var(--text-highlight-bg)' : 'var(--text-faint)' }}></span>
				<span className="annotation-category">{annotation.type === 'highlight' ? 'Highlight:' : 'Suggestion:'}</span>
				<span className="annotation-text-preview">"{annotation.text}"</span>
            </div>
            <div className="annotation-edit-area">
                <textarea 
                    ref={textareaRef}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Add a comment..."
                    onBlur={handleSave}
                    onKeyDown={(e) => {
                        // Save on Ctrl/Cmd + Enter
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
							e.preventDefault();
                            handleSave();
                        }
                        // Save and exit on Escape
                        if (e.key === 'Escape') {
							e.preventDefault();
                            handleSave();
                        }
                    }}
                />
            </div>
        </div>
    );
}