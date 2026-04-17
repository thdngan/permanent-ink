import { EditorState, StateField, type Extension, StateEffect, type Range, Facet } from "@codemirror/state";
import { EditorView, Decoration, type DecorationSet, WidgetType, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { createRoot, type Root } from "react-dom/client";
import { useState, useLayoutEffect, type CSSProperties, useRef, useEffect } from 'react';
import CommentPopover from "./popover";
import { editorLivePreviewField, Notice } from "obsidian";
import { matchColor } from "@/lib/utils";
import Draggable from 'react-draggable';

// --- GLOBAL POPOVER SETUP ---
const unifiedPopoverContainerEl = document.createElement("div");
unifiedPopoverContainerEl.setAttribute("popover", "auto");
unifiedPopoverContainerEl.id = "perink-unified-popover-container";
document.body.appendChild(unifiedPopoverContainerEl);
const unifiedPopoverRoot: Root = createRoot(unifiedPopoverContainerEl);

export function cleanup() {
	unifiedPopoverRoot.unmount();
	unifiedPopoverContainerEl.remove();
}

// --- REACT COMPONENT: ColorPalette ---
interface ColorPaletteProps {
	onSelect: (color: string | null) => void;
	colorOptions: string[];
}
function ColorPalette({ onSelect, colorOptions }: ColorPaletteProps) {
	return (
		<div className="perink-palette-container">
			<div className="flex flex-nowrap items-center justify-center">
				<div
					onClick={() => onSelect(null)}
					className="perink-color-blob"
					style={{ '--blob-color': 'var(--text-highlight-bg)' } as CSSProperties}
					title="Default color"
				/>
				{colorOptions.map((color) => (
					<div
						key={color}
						onClick={() => onSelect(color)}
						className="perink-color-blob"
						style={{ '--blob-color': color } as CSSProperties}
						title={color}
					/>
				))}
			</div>
		</div>
	);
}

// --- REACT COMPONENT: CombinedPopover ---
interface CombinedPopoverProps {
	anchorEl: HTMLElement;
	type: 'highlight' | 'strikethrough';
	initialComment: string;
	textToCopy: string;
	onSave: (fullComment: string) => void;
	onRemove: () => void;
	popoverRef: HTMLElement;
	colorOptions: string[];
}

function CombinedPopover({ anchorEl, type, initialComment, textToCopy, onSave, onRemove, popoverRef, colorOptions }: CombinedPopoverProps) {
	const [commentText, setCommentText] = useState("");
	const [selectedColor, setSelectedColor] = useState<string | null>(null);
    const [initialPosition, setInitialPosition] = useState<{ x: number; y: number } | null>(null);
	const wasActionTaken = useRef(false);

	useLayoutEffect(() => {
		wasActionTaken.current = false;

		const color = matchColor(initialComment);
		const text = initialComment.replace(`@${color}`, "").trim();
		setCommentText(text);
		setSelectedColor(color);

		const rect = anchorEl.getBoundingClientRect();
		const commentBoxX = rect.left + window.scrollX + (rect.width / 2) - 140;
		const commentBoxY = rect.bottom + window.scrollY + 5;
		setInitialPosition({ x: commentBoxX, y: commentBoxY });
		
	}, [anchorEl, initialComment]);

	const buildFullComment = (text: string, color: string | null): string => {
		const trimmedText = text.trim();
		const colorString = color ? ` @${color}` : "";
		return (trimmedText ? `${trimmedText}${colorString}` : colorString);
	};

	const handleColorSelect = (color: string | null) => {
		wasActionTaken.current = true;
		if (commentText.includes("-->") || commentText.includes("<!--")) {
			new Notice("Comment cannot contain '-->' or '<!--'.");
			wasActionTaken.current = false;
			return;
		}
		const fullComment = buildFullComment(commentText, color);
		onSave(fullComment);
		popoverRef.hidePopover();
	};

	const handleRemove = () => {
		wasActionTaken.current = true;
		onRemove();
		popoverRef.hidePopover();
	};

	const handleCopy = () => {
		wasActionTaken.current = true;
		navigator.clipboard.writeText(textToCopy);
		new Notice("Copied to clipboard");

		if (commentText.includes("-->") || commentText.includes("<!--")) {
			new Notice("Comment cannot contain '-->' or '<!--'.");
			wasActionTaken.current = false;
			return;
		}
		const fullComment = buildFullComment(commentText, selectedColor);
		onSave(fullComment);
		popoverRef.hidePopover();
	};

	useEffect(() => {
		const handleToggle = (e: ToggleEvent) => {
			if (e.newState === 'closed' && !wasActionTaken.current) {
				if (commentText.includes("-->") || commentText.includes("<!--")) {
					new Notice("Comment cannot include '<!--' or '-->', changes discarded.");
					return;
				}
				const fullComment = buildFullComment(commentText, selectedColor);
				onSave(fullComment);
			}
		};

		popoverRef.addEventListener('toggle', handleToggle as EventListener);
		return () => popoverRef.removeEventListener('toggle', handleToggle as EventListener);

	}, [commentText, selectedColor, popoverRef, onSave]);
	
	if (!initialPosition) return null;

	return (
		<Draggable handle=".perink-popover-drag-handle" defaultPosition={initialPosition}>
			<div className="perink-draggable-container absolute cursor-default">
				<div className="flex flex-col items-center">
					{type === 'highlight' && (
						<div className="perink-palette-wrapper mb-2">
							<ColorPalette onSelect={handleColorSelect} colorOptions={colorOptions} />
						</div>
					)}
					<div className="perink-popover-wrapper">
						<CommentPopover
							commentText={commentText}
							onCommentChange={setCommentText}
							textToCopy={textToCopy}
							onCopy={handleCopy}
							onRemove={handleRemove}
						/>
					</div>
				</div>
			</div>
		</Draggable>
	);
}


// --- STATE EFFECTS ---
const ShowPopoverEffect = StateEffect.define<{ from: number; to: number; type: 'highlight' | 'strikethrough' }>();
// Define a new effect to trigger an existing popover
export const TriggerPopoverEffect = StateEffect.define<{ from: number, to: number }>();


// --- UNIFIED ANNOTATION WIDGET ---
export class AnnotationWidget extends WidgetType {
	private view: EditorView | null = null;
	private wrapperEl?: HTMLElement;

	constructor(
		private text: string,
		private comment: string,
		private from: number,
		private to: number,
		private hasComment: boolean,
		private type: 'highlight' | 'strikethrough',
		private colorOptions: string[]
	) {
		super();
	}

	eq(other: AnnotationWidget): boolean {
		return this.text === other.text && this.comment === other.comment && this.from === other.from && this.to === other.to && this.type === other.type;
	}

	toDOM(view: EditorView): HTMLElement {
		this.view = view;
		this.wrapperEl = document.createElement("span");
		this.wrapperEl.className = `perink-${this.type}`;
		if (this.hasComment) this.wrapperEl.classList.add("has-comment");

		if (this.type === 'highlight') {
			this.wrapperEl.textContent = this.text;
			this.setHighlightColor(this.comment);
		} else {
			const innerSpan = document.createElement("span");
			innerSpan.textContent = this.text;
			this.wrapperEl.appendChild(innerSpan);
		}
		
		if (this.comment) this.wrapperEl.title = this.comment.replace(/@\w+/, '').trim();

		this.wrapperEl.addEventListener("click", () => this.showPopovers());
		return this.wrapperEl;
	}

	public showPopovers() {
		if (!this.view || !this.wrapperEl) return;
		
		const popoverEl = unifiedPopoverContainerEl;

		unifiedPopoverRoot.render(
			<CombinedPopover
				key={this.from}
				anchorEl={this.wrapperEl}
				type={this.type}
				initialComment={this.comment}
				textToCopy={this.text}
				onSave={(fullComment) => {
					const tags = this.type === 'highlight' ? ['==', '=='] : ['~~', '~~'];
					this.handleUpdate(fullComment, tags[0], tags[1]);
				}}
				onRemove={() => this.handleRemoval()}
				popoverRef={popoverEl}
				colorOptions={this.colorOptions}
			/>
		);
		
		popoverEl.showPopover();
	}

	private handleRemoval() {
		if (!this.view) return;
		this.view.dispatch({
			changes: { from: this.from, to: this.to, insert: this.text },
		});
	}

	private handleUpdate(newComment: string, startTag: string, endTag: string) {
		if (!this.view) return;
		const newText = newComment.trim() === ""
			? `${startTag}${this.text}${endTag}`
			: `${startTag}${this.text}${endTag}<!--${newComment}-->`;
		
		if (this.type === 'highlight') this.setHighlightColor(newComment);

		this.view.dispatch({
			changes: { from: this.from, to: this.to, insert: newText },
		});
	}

	private setHighlightColor(comment: string) {
		if (!this.wrapperEl || this.type !== 'highlight') return;
		const color = matchColor(comment);
		this.wrapperEl.style.backgroundColor = color || "var(--text-highlight-bg)";
	}
}

// --- WIDGET FOR QUAD INDENTATION ---
export class QuadWidget extends WidgetType {
	constructor(private text: string, private to: number) {
		super();
	}

	eq(other: QuadWidget): boolean {
		return this.text === other.text && this.to === other.to;
	}

	// Tells the CodeMirror editor to completely ignore
	// its default behavior for 'mousedown' events on this widget.
	ignoreEvent(event: Event): boolean {
		return event.type === 'mousedown';
	}

	toDOM(view: EditorView): HTMLElement {
		const span = document.createElement("span");
		span.className = 'perink-quad-widget';
		span.setAttribute('aria-hidden', 'true');
		
		const quadCount = (this.text.match(/\\quad/g) || []).length;
		span.textContent = "\u00A0\u00A0\u00A0\u00A0".repeat(quadCount);

		span.addEventListener("mousedown", (event) => {
			event.preventDefault();
			event.stopPropagation();

			// Dispatch the cursor move and focus the editor.
			view.dispatch({
				selection: { anchor: this.to }
			});
			view.focus();
		});

		return span;
	}
}

// --- FACET FOR CONFIGURATION ---
const colorOptionsFacet = Facet.define<string[], string[]>({
	combine: values => values[0] ?? []
});


// --- DECORATION LOGIC ---
function createDecorations(state: EditorState, colorOptions: string[]): DecorationSet {
	const decorations: Range<Decoration>[] = [];
	
	const processMatches = (regex: RegExp, type: 'highlight' | 'strikethrough') => {
		for (const match of state.doc.toString().matchAll(regex)) {
			if (match.index === undefined) continue;
			const from = match.index;
			const to = from + match[0].length;
			const text = match[1];
			const comment = match[2] || "";
			const matchedColor = matchColor(comment);
            const cleanComment = comment.trim().replace(`@${matchedColor ?? ""}`, "").trim();
            const hasComment = !!cleanComment;

			decorations.push(
				Decoration.replace({
					widget: new AnnotationWidget(text, comment, from, to, hasComment, type, colorOptions),
				}).range(from, to)
			);
		}
	};
	
	// --- Find and decorate quad blocks first to make them atomic ---
	// This regex finds quad blocks that are used for indentation at the start of a line.
	const quadRegex = /(^\s*)(\$\s*(?:\\quad\s*)+\$\s*)/gm;
	for (const match of state.doc.toString().matchAll(quadRegex)) {
		if (match.index === undefined) continue;
		const from = match.index + match[1].length;
		const to = from + match[2].length;
		decorations.push(
			Decoration.replace({
				widget: new QuadWidget(match[2], to), // Pass the 'to' offset here
			}).range(from, to)
		);
	}
	
	processMatches(/==(.*?)==(?:<!--(.*?)-->)?/gs, 'highlight');
	processMatches(/~~(.*?)~~(?:<!--(.*?)-->)?/gs, 'strikethrough');

	return Decoration.set(decorations, true);
}


// --- CODEMIRROR EXTENSION ---
export const decorationStateField = StateField.define<DecorationSet>({
	create(state) {
		const colors = state.facet(colorOptionsFacet);
		return state.field(editorLivePreviewField) ? createDecorations(state, colors) : Decoration.none;
	},
	update(decorations, tr) {
		const colors = tr.state.facet(colorOptionsFacet);
		const isLivePreview = tr.state.field(editorLivePreviewField);
		if (!isLivePreview) return Decoration.none;
		if (tr.docChanged || tr.startState.field(editorLivePreviewField) !== isLivePreview) {
			return createDecorations(tr.state, colors);
		}
		return decorations.map(tr.changes);
	},
	provide: (f) => EditorView.decorations.from(f),
});

export function highlightExtension(colorOptions: string[]): Extension {
	const popoverPlugin = ViewPlugin.fromClass(class {
		update(update: ViewUpdate) {
			const findAndShow = (from: number, to: number, type?: 'highlight' | 'strikethrough') => {
				update.state.field(decorationStateField).between(from, to, (dFrom, _dTo, deco) => {
					if (dFrom === from) {
						const widget = deco.spec.widget as AnnotationWidget;
						if (widget instanceof AnnotationWidget && (!type || widget['type'] === type)) {
							// Directly tell the widget to show itself. The widget will handle the details.
							widget.showPopovers();
							return false; // Stop searching
						}
					}
				});
			};

			for (const tr of update.transactions) {
				const showEffect = tr.effects.find(e => e.is(ShowPopoverEffect));
				if (showEffect) {
					// Use a minimal timeout here ONLY for new creations to ensure the widget has been rendered.
					setTimeout(() => findAndShow(showEffect.value.from, showEffect.value.to, showEffect.value.type), 0);
					continue;
				}

				const triggerEffect = tr.effects.find(e => e.is(TriggerPopoverEffect));
				if (triggerEffect) {
					// No timeout needed when triggering an existing widget.
					findAndShow(triggerEffect.value.from, triggerEffect.value.to);
					continue;
				}
			}
		}
	});

	return [
		decorationStateField,
		popoverPlugin,
		colorOptionsFacet.of(colorOptions)
	];
}

// --- PUBLIC COMMANDS FOR CREATING MARKS ---
function createMark(view: EditorView, tag: "==" | "~~", showPopover: boolean) {
	const selection = view.state.selection.main;
	if (selection.empty) return false;

	const selectedText = view.state.doc.sliceString(selection.from, selection.to);
	const markText = `${tag}${selectedText}${tag}`;
	
	const effects = showPopover ? [ShowPopoverEffect.of({
		from: selection.from,
		to: selection.from + markText.length,
		type: tag === '==' ? 'highlight' : 'strikethrough'
	})] : [];

	view.dispatch({
		changes: { from: selection.from, to: selection.to, insert: markText },
		effects: effects,
	});
	return true;
}

export function createHighlight(view: EditorView) {
	return createMark(view, "==", true);
}

export function createStrikethrough(view: EditorView) {
	return createMark(view, "~~", true);
}

export function applyStrikethroughWithoutPopover(view: EditorView) {
    return createMark(view, "~~", false);
}