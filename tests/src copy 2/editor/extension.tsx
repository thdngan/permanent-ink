import { EditorState, StateField, type Extension, Text, StateEffect, type Range } from "@codemirror/state";
import { EditorView, Decoration, type DecorationSet, WidgetType, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { createRoot, type Root } from "react-dom/client";
import CommentPopover from "./popover";
import { editorLivePreviewField } from "obsidian";
import { matchColor } from "@/lib/utils";

// --- GLOBAL POPOVER SETUP ---
const popoverContainerEl = document.createElement("div");
popoverContainerEl.setAttribute("popover", "auto");
popoverContainerEl.id = "perink-comment-popover-container";
document.body.appendChild(popoverContainerEl);
const popoverRoot: Root = createRoot(popoverContainerEl);

// --- STATE EFFECTS ---
const ShowPopoverEffect = StateEffect.define<{ from: number; to: number; type: 'highlight' | 'strikethrough' }>();

// --- UNIFIED ANNOTATION WIDGET ---
class AnnotationWidget extends WidgetType {
	private view: EditorView | null = null;
	private wrapperEl?: HTMLElement;

	constructor(
		private text: string,
		private comment: string, // now defaults to ""
		private from: number,
		private to: number,
		private hasComment: boolean,
		private type: 'highlight' | 'strikethrough',
		private colorOptions: string[]
	) {
		super();
	}

	eq(other: AnnotationWidget): boolean {
		return this.text === other.text &&
			this.comment === other.comment &&
			this.from === other.from &&
			this.to === other.to &&
			this.type === other.type;
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

		this.wrapperEl.addEventListener("click", () => this.showPopover());
		return this.wrapperEl;
	}

	private showPopover() {
		if (!this.view || !this.wrapperEl) return;
		
		const popoverEl = document.getElementById("perink-comment-popover-container");
		if (!popoverEl) return;

		// --- Render the unified popover ---
		popoverRoot.render(
			<CommentPopover
				key={this.from}
				type={this.type}
				initialComment={this.comment}
				colorOptions={this.colorOptions}
				textToCopy={this.text}
				onSave={(fullComment) => {
					const tags = this.type === 'highlight' ? ['==', '=='] : ['~~', '~~'];
					this.handleUpdate(fullComment, tags[0], tags[1]);
				}}
				onRemove={() => this.handleRemoval()}
				popoverRef={popoverEl}
			/>
		);
		
		this.positionPopover(popoverEl);
		
		const keydownHandler = (evt: KeyboardEvent) => {
			if (!(evt.target instanceof HTMLTextAreaElement)) {
				popoverEl.hidePopover();
			}
		};
		popoverEl.addEventListener('close', () => document.removeEventListener('keydown', keydownHandler, true), { once: true });
		document.addEventListener('keydown', keydownHandler, true);
		
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

	private positionPopover(popover: HTMLElement) {
		if (!this.wrapperEl) return;
		const rect = this.wrapperEl.getBoundingClientRect();
		popover.style.top = `${rect.bottom + window.scrollY + 5}px`;
		popover.style.left = `${rect.left + window.scrollX + (rect.width / 2) - (popover.offsetWidth / 2)}px`;
	}

	private setHighlightColor(comment: string) {
		if (!this.wrapperEl || this.type !== 'highlight') return;
		const color = matchColor(comment);
		this.wrapperEl.style.backgroundColor = color || "var(--text-highlight-bg)";
	}
}


// --- DECORATION LOGIC ---
function createDecorations(state: EditorState, colorOptions: string[]): DecorationSet {
	const decorations: Range<Decoration>[] = [];
	const docText = state.doc.toString();
	
	const processMatches = (regex: RegExp, type: 'highlight' | 'strikethrough') => {
		for (const match of docText.matchAll(regex)) {
			const from = match.index!;
			const to = from + match[0].length;
			const text = match[1];
			const comment = match[2] || ""; // Default to empty string
			// const hasComment = !!comment && comment.trim() !== "" && comment.trim() !== `@${matchColor(comment)}`;
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
	
	processMatches(/==(.*?)==(?:<!--(.*?)-->)?/gs, 'highlight');
	processMatches(/~~(.*?)~~(?:<!--(.*?)-->)?/gs, 'strikethrough');

	return Decoration.set(decorations, true);
}


// --- CODEMIRROR EXTENSION ---
// (This part remains unchanged from the previous refactor)
export function highlightExtension(colorOptions: string[]): Extension {
	const decorationStateField = StateField.define<DecorationSet>({
		create(state) {
			return state.field(editorLivePreviewField) ? createDecorations(state, colorOptions) : Decoration.none;
		},
		update(decorations, tr) {
			const isLivePreview = tr.state.field(editorLivePreviewField);
			if (!isLivePreview) return Decoration.none;
			if (tr.docChanged || tr.startState.field(editorLivePreviewField) !== isLivePreview) {
				return createDecorations(tr.state, colorOptions);
			}
			return decorations.map(tr.changes);
		},
		provide: (f) => EditorView.decorations.from(f),
	});

	const popoverPlugin = ViewPlugin.fromClass(class {
		update(update: ViewUpdate) {
			for (const tr of update.transactions) {
				const effect = tr.effects.find(e => e.is(ShowPopoverEffect));
				if (!effect) continue;

				const { from, to, type } = effect.value;
				update.state.field(decorationStateField).between(from, to, (_, __, deco) => {
					const widget = deco.spec.widget as AnnotationWidget;
					if (widget instanceof AnnotationWidget && widget['type'] === type) {
						setTimeout(() => widget['showPopover'](), 0);
						return false;
					}
				});
			}
		}
	});

	return [decorationStateField, popoverPlugin];
}

// --- PUBLIC COMMANDS FOR CREATING MARKS ---
// (This part remains unchanged from the previous refactor)
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

export function cleanup() {
	popoverRoot.unmount();
	popoverContainerEl.remove();
}