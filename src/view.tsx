import { ItemView, type Editor, type WorkspaceLeaf } from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { FocusFlashEffect } from "./editor/extension";
import { IconButton, RenderedMarkdown } from "./editor/notes";
import { noteMarker, type NoteStore } from "./notes";
import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { setIcon } from "obsidian";

export const OMNIDIAN_ANNOTATIONS_VIEW_TYPE = "omnidian-annotations-view";

// Kept in sync with the length of the perink-focus-flash animation in styles.css
const FLASH_DURATION_MS = 2000;

// Vertical breathing room between two cards that would otherwise overlap
const CARD_GAP = 8;

export interface Annotation {
	type: 'highlight' | 'strikethrough' | 'note';
	text: string;
	comment: string;
	line: number;
	color: string | null;
	from: number;
	to: number;
	// Only for notes, whose content lives in a file named after this id
	noteId?: string;
}

interface EditorWithCm extends Editor {
	cm: EditorView;
}

export class OmnidianAnnotationsView extends ItemView {
	private root: Root | null = null;
	private annotations: Annotation[] = [];
	private associatedEditor: Editor | null = null;
	private flashTimeout: number | null = null;
	private flashWindow: Window | null = null;
	private pointerIsDown = false;
	private docPath: string | null = null;
	private unsubscribeNotes: (() => void) | null = null;

	constructor(leaf: WorkspaceLeaf, private notes: NoteStore) {
		super(leaf);
	}

	getViewType() { return OMNIDIAN_ANNOTATIONS_VIEW_TYPE; }
	getDisplayText() { return "Annotations"; }
	getIcon() { return "message-square-quote"; }

	onOpen(): Promise<void> {
		const container = this.containerEl.children[1];
		container.empty();
		this.root = createRoot(container);

		// The comment box saves when it loses focus, and the click that takes the focus away
		// is usually still in progress at that point, so saves need to know about it.
		const win = this.containerEl.win;
		this.registerDomEvent(win, "mousedown", () => { this.pointerIsDown = true; }, { capture: true });
		this.registerDomEvent(win, "mouseup", () => { this.pointerIsDown = false; }, { capture: true });

		// Note content is loaded lazily and can change from the popover or the file itself.
		this.unsubscribeNotes = this.notes.subscribe(() => this.render());

		this.render();
		return Promise.resolve();
	}

	onClose(): Promise<void> {
		this.cancelPendingFlash();
		this.unsubscribeNotes?.();
		this.root?.unmount();
		return Promise.resolve();
	}

	public setData(annotations: Annotation[], editor: Editor, docPath: string | null) {
		this.annotations = annotations;
		this.associatedEditor = editor;
		this.docPath = docPath;
		this.render();
	}

	public clear() {
		this.annotations = [];
		this.associatedEditor = null;
		this.docPath = null;
		this.render();
	}

	private render() {
		if (this.root) {
			// The component owns the scrolling element, since it has to keep it in step with
			// the editor's own scrolling.
			this.root.render(
				<AnnotationsListComponent
					annotations={this.annotations}
					editorView={this.associatedEditor ? (this.associatedEditor as EditorWithCm).cm : null}
					onItemClick={(from, to) => this.jumpToAnnotation(from, to)}
					onCommentUpdate={(from, to, text, type, newComment, color) => 
						this.updateAnnotationComment(from, to, text, type, newComment, color)}
					onItemRemove={(from, to, text) => this.removeAnnotation(from, to, text)}
					notes={this.notes}
					docPath={this.docPath}
					onNoteRemove={(id) => this.removeNote(id)}
				/>
			);
		}
	}

	private jumpToAnnotation(from: number, to: number) {
		if (!this.associatedEditor) return;
		const editor = this.associatedEditor;
		const view = (editor as EditorWithCm).cm;

		// The offsets come from the last scan of the document, so clamp them in case it shrank.
		const docLength = view.state.doc.length;
		const start = Math.max(0, Math.min(from, docLength));
		const end = Math.max(start, Math.min(to, docLength));

		// The editor is deliberately not focused here. The card that was just clicked opens
		// its comment box and takes the focus straight back, so focusing the editor would only
		// add a focus change for the next click in the editor to trip over.

		// Clear a flash that is still running, otherwise clicking a second card would reuse
		// the same element and the fade out animation would not start over.
		if (this.flashTimeout !== null) {
			this.cancelPendingFlash();
			view.dispatch({ effects: FocusFlashEffect.of(null) });
		}

		// Scroll and outline in one transaction. CodeMirror carries the outline along with
		// the text, so it stays on the annotation however the scroll and the line height
		// measurements settle afterwards.
		view.dispatch({
			effects: [
				EditorView.scrollIntoView(EditorSelection.range(start, end), { y: "center" }),
				FocusFlashEffect.of({ from: start, to: end }),
			],
		});

		this.scheduleFlashRemoval(view);
	}

	private scheduleFlashRemoval(view: EditorView) {
		const win = view.dom.ownerDocument.defaultView ?? activeWindow;
		this.flashWindow = win;
		this.flashTimeout = win.setTimeout(() => {
			this.flashTimeout = null;
			this.flashWindow = null;
			// Dispatching on a destroyed view is a no-op, so no extra guard is needed here.
			view.dispatch({ effects: FocusFlashEffect.of(null) });
		}, FLASH_DURATION_MS);
	}

	private cancelPendingFlash() {
		if (this.flashTimeout !== null) {
			(this.flashWindow ?? activeWindow).clearTimeout(this.flashTimeout);
			this.flashTimeout = null;
		}
		this.flashWindow = null;
	}

	/**
	 * Runs a write to the document once no mouse button is being held.
	 *
	 * The comment box saves when it loses focus, and what usually takes that focus away is a
	 * click in the editor. CodeMirror reads the position under the pointer before it moves
	 * focus and again afterwards, so a document change dispatched in between leaves it with
	 * two different positions and it selects everything between them. Waiting for the button
	 * to come back up keeps the write out of the middle of the click.
	 */
	private writeWhenPointerIsUp(write: () => void) {
		if (!this.pointerIsDown) {
			write();
			return;
		}

		const win = this.containerEl.win;
		let done = false;

		const run = () => {
			if (done) return;
			done = true;
			win.clearTimeout(fallback);
			win.removeEventListener("mouseup", run);
			// One more tick so CodeMirror finishes handling the click first.
			win.setTimeout(write, 0);
		};

		// Bubble phase on the window, which comes after CodeMirror's own mouseup handler.
		win.addEventListener("mouseup", run);
		// In case the button comes up somewhere we never hear about it.
		const fallback = win.setTimeout(run, 2000);
	}

	private updateAnnotationComment(from: number, to: number, text: string, type: 'highlight' | 'strikethrough', newComment: string, color: string | null) {
		if (!this.associatedEditor) return;
		const editor = this.associatedEditor;

		const buildFullComment = (text: string, color: string | null): string => {
			const trimmedText = text.trim();
			const colorString = color ? ` @${color}` : "";
			return (trimmedText ? `${trimmedText}${colorString}` : colorString);
		};

		const fullCommentText = buildFullComment(newComment, type === 'highlight' ? color : null);
		const tag = type === 'highlight' ? '==' : '~~';
		
		const newAnnotation = fullCommentText
			? `${tag}${text}${tag}<!--${fullCommentText}-->`
			: `${tag}${text}${tag}`;

		const fromPos = editor.offsetToPos(from);
		const toPos = editor.offsetToPos(to);
		const currentText = editor.getRange(fromPos, toPos);

		// A save runs on every blur, so most of them have nothing to write.
		if (currentText === newAnnotation) return;

		// These offsets come from the last scan of the document. If they no longer point at an
		// annotation then the text moved on without us, so leave it alone rather than overwrite
		// whatever is there now.
		const looksLikeAnnotation = currentText.startsWith(tag) && (currentText.endsWith(tag) || currentText.endsWith("-->"));
		if (!looksLikeAnnotation) return;

		// Manually calculate offset changes to prevent race conditions on subsequent annotations
		const originalLength = to - from;
		const newLength = newAnnotation.length;
		const offsetDelta = newLength - originalLength;

		this.writeWhenPointerIsUp(() => {
			// The write may have waited for a click to finish, so check the text once more.
			if (editor.getRange(fromPos, toPos) !== currentText) return;

			editor.replaceRange(newAnnotation, fromPos, toPos);

			// Immediately update the offsets of ALL annotations in the view state
			this.annotations = this.annotations.map(ann => {
				if (ann.from === from) {
					return {
						...ann,
						comment: newComment,
						to: from + newLength // Update the length of the current annotation
					};
				} else if (ann.from > from) {
					return {
						...ann,
						from: ann.from + offsetDelta, // Shift subsequent annotations
						to: ann.to + offsetDelta
					};
				}
				return ann;
			});

			// Force an immediate re-render with the updated data.
			this.render();
		});
	}

	private removeNote(id: string) {
		if (!this.associatedEditor || !this.docPath) return;
		const editor = this.associatedEditor;

		// Found by id rather than by the stored offsets, which may be out of date by now.
		const marker = noteMarker(id);
		const from = editor.getValue().indexOf(marker);
		if (from !== -1) {
			editor.replaceRange("", editor.offsetToPos(from), editor.offsetToPos(from + marker.length));
			this.annotations = this.annotations
				.filter(ann => ann.noteId !== id)
				.map(ann => ann.from > from
					? { ...ann, from: ann.from - marker.length, to: ann.to - marker.length }
					: ann);
		}
		void this.notes.remove(id, this.docPath);
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
function AnnotationsListComponent({ annotations, editorView, onItemClick, onCommentUpdate, onItemRemove, notes, docPath, onNoteRemove }: { 
    annotations: Annotation[], 
    editorView: EditorView | null,
    onItemClick: (from: number, to: number) => void,
    onCommentUpdate: (from: number, to: number, text: string, type: 'highlight' | 'strikethrough', newComment: string, color: string | null) => void,
	onItemRemove: (from: number, to: number, text: string) => void,
	notes: NoteStore,
	docPath: string | null,
	onNoteRemove: (id: string) => void
}) {
    const [editingAnnotationFrom, setEditingAnnotationFrom] = useState<number | null>(null);
    const isSwitchingAnnotation = useRef(false);
	const paneRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLDivElement>(null);
	const cardRefs = useRef(new Map<number, HTMLElement>());

	// Anchoring the cards needs an editor on screen to measure against. Reading mode has an
	// editor that is not laid out, so the plain list is used there instead.
	const anchored = !!editorView && editorView.scrollDOM.clientHeight > 0;
 
     const handleCardClick = (annotation: Annotation) => {
        isSwitchingAnnotation.current = true;
		onItemClick(annotation.from, annotation.to);
		setEditingAnnotationFrom(annotation.from);

        setTimeout(() => {
            isSwitchingAnnotation.current = false;
        }, 100);
     };

    const finishEditing = () => {
		if (!isSwitchingAnnotation.current) {
			 setEditingAnnotationFrom(null);
		}
    };

    const handleSave = (annotation: Annotation, newComment: string) => {
		if (annotation.type === 'note') return;
        onCommentUpdate(annotation.from, annotation.to, annotation.text, annotation.type, newComment, annotation.color);
		finishEditing();
    };

	// Keep every card beside the text it belongs to, and the pane scrolled with the document.
	useLayoutEffect(() => {
		const view = editorView;
		const pane = paneRef.current;
		const canvas = canvasRef.current;
		if (!anchored || !view || !pane || !canvas) return;

		const win = pane.ownerDocument.defaultView ?? activeWindow;
		const scroller = view.scrollDOM;
		const ordered = [...annotations].sort((a, b) => a.from - b.from);
		let frame = 0;
		let mirroringScroll = false;

		// Where the annotation sits on screen. A position CodeMirror has rendered can be
		// measured exactly, anything else comes from its height map, which covers the whole
		// document and corrects itself as those lines get measured.
		const anchorTop = (offset: number) => {
			const pos = Math.min(offset, view.state.doc.length);
			if (pos >= view.viewport.from && pos <= view.viewport.to) {
				const coords = view.coordsAtPos(pos);
				if (coords) return coords.top;
			}
			return view.documentTop + view.lineBlockAt(pos).top;
		};

		const layout = () => {
			canvas.style.height = `${view.contentHeight + pane.clientHeight}px`;
			// Mirror the document's scroll position so the pane's own scrollbar means the
			// same thing the editor's does.
			if (Math.abs(pane.scrollTop - scroller.scrollTop) > 0.5) {
				mirroringScroll = true;
				pane.scrollTop = scroller.scrollTop;
			}

			// Measure first and write afterwards, so scrolling does not thrash the layout.
			const cards = ordered.map(annotation => cardRefs.current.get(annotation.from));
			const anchors = ordered.map(annotation => anchorTop(annotation.from));
			const heights = cards.map(card => card?.offsetHeight ?? 0);
			const canvasTop = canvas.getBoundingClientRect().top;

			let previousBottom = -Infinity;
			for (let i = 0; i < cards.length; i++) {
				const card = cards[i];
				if (!card) continue;
				// Cards never overlap, so one with a neighbour just above it slides down.
				const top = Math.max(anchors[i] - canvasTop, previousBottom + CARD_GAP);
				card.style.top = `${Math.round(top)}px`;
				previousBottom = top + heights[i];
			}
		};

		const onEditorScroll = () => {
			if (frame) return;
			frame = win.requestAnimationFrame(() => {
				frame = 0;
				layout();
			});
		};

		const onPaneScroll = () => {
			// Ignore the scroll we just caused ourselves, otherwise the two fight each other.
			if (mirroringScroll) {
				mirroringScroll = false;
				return;
			}
			scroller.scrollTop = pane.scrollTop;
		};

		// Cards change height when a comment is edited or the textarea is dragged, the editor
		// reflows when the window or the sidebar is resized, and the text below an edit moves
		// when the document grows or shrinks.
		const resizeObserver = new ResizeObserver(() => layout());
		resizeObserver.observe(scroller);
		resizeObserver.observe(view.contentDOM);
		for (const card of cardRefs.current.values()) resizeObserver.observe(card);

		scroller.addEventListener("scroll", onEditorScroll, { passive: true });
		pane.addEventListener("scroll", onPaneScroll, { passive: true });
		layout();

		return () => {
			scroller.removeEventListener("scroll", onEditorScroll);
			pane.removeEventListener("scroll", onPaneScroll);
			resizeObserver.disconnect();
			if (frame) win.cancelAnimationFrame(frame);
		};
	}, [annotations, editorView, anchored, editingAnnotationFrom]);

	const setCardRef = (from: number, el: HTMLElement | null) => {
		if (el) cardRefs.current.set(from, el);
		else cardRefs.current.delete(from);
	};
	
	if (annotations.length === 0) {
		return (
			<div className="omnidian-annotations-view" ref={paneRef}>
				<div className="annotation-list-empty"><p>No annotations in the current file.</p></div>
			</div>
		);
	}

	const cards = annotations.map((annotation, index) => (
		<div
			key={`${annotation.from}-${index}`}
			className="annotation-anchor"
			ref={(el) => setCardRef(annotation.from, el)}
		>
			{annotation.type === 'note' && annotation.noteId && docPath ? (
				// Read only like the popover: clicking jumps to the pin, the text can be selected,
				// and the note is written in its own tab.
				<div className="annotation-card" onMouseDown={() => onItemClick(annotation.from, annotation.to)}>
					<div className="annotation-card-header">
						<div className="annotation-card-header-content">
							<span className="annotation-type-indicator" style={{ backgroundColor: 'var(--interactive-accent)' }}></span>
							<span className="annotation-category">Note</span>
						</div>
						<IconButton
							icon="pencil"
							label="Open note in a new tab"
							className="annotation-open-btn"
							onClick={() => void notes.open(annotation.noteId as string, docPath)}
						/>
						<RemoveButton onClick={(e) => {
							e.stopPropagation();
							onNoteRemove(annotation.noteId as string);
						}} />
					</div>
					<NotePreview store={notes} docPath={docPath} id={annotation.noteId} />
				</div>
			) : editingAnnotationFrom === annotation.from ? (
				<AnnotationEditComponent 
					annotation={annotation}
					onSave={(newComment) => handleSave(annotation, newComment)}
				/>
			) : (
				<div className="annotation-card" onMouseDown={() => handleCardClick(annotation)}>
					<div className="annotation-card-header">
						<div className="annotation-card-header-content">
							<span className="annotation-type-indicator" style={{ backgroundColor: annotation.type === 'highlight' ? annotation.color ?? 'var(--text-highlight-bg)' : 'var(--text-faint)' }}></span>
							<span className="annotation-category">{annotation.type === 'highlight' ? 'Highlight:' : annotation.comment ? 'Replace:' : 'Delete:'}</span>
							<span className="annotation-text-preview">&quot;{annotation.text}&quot;</span>
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
			)}
		</div>
	));

	return (
		<div className={`omnidian-annotations-view${anchored ? " is-anchored" : ""}`} ref={paneRef}>
			{anchored
				? <div className="annotation-canvas" ref={canvasRef}>{cards}</div>
				: <div className="annotation-list">{cards}</div>}
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
function AnnotationEditComponent({ annotation, onSave }: {
    annotation: Annotation;
    onSave: (newComment: string) => void;
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
				<span className="annotation-text-preview">&quot;{annotation.text}&quot;</span>
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


// A note's content on its card, rendered as markdown and trimmed to a few lines.
function NotePreview({ store, docPath, id }: { store: NoteStore, docPath: string, id: string }) {
	const content = store.peek(id);

	// Loading fills the cache and notifies the view, which renders this card again.
	useEffect(() => {
		if (content === undefined) void store.read(id, docPath);
	}, [store, content, docPath, id]);

	if (content === undefined) return null;
	if (!content.trim()) return <div className="annotation-note-empty">Empty note</div>;
	return <RenderedMarkdown store={store} markdown={content} sourcePath={store.sourcePathFor(id, docPath)} className="annotation-note-preview" />;
}
