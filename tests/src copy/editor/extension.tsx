import {
	EditorState,
	StateField,
	type Extension,
	Text,
	StateEffect,
	type Range,
	type StateEffectType,
} from "@codemirror/state";
import {
	EditorView,
	Decoration,
	type DecorationSet,
	WidgetType,
	ViewPlugin,
	type ViewUpdate,
} from "@codemirror/view";
import { createRoot } from "react-dom/client";
import CommentPopover from "./popover";
import StrikethroughPopover from "./strikethrough-popover";
import { editorLivePreviewField } from "obsidian";
import { matchColor } from "@/lib/utils";

// --- GLOBAL POPOVER CONTAINER ---
const popoverContainerEl = document.createElement("div");
popoverContainerEl.setAttribute("popover", "auto");
popoverContainerEl.setAttribute("id", "perink-comment-popover-container");
document.body.appendChild(popoverContainerEl);
const root = createRoot(popoverContainerEl);

// --- STATE EFFECTS ---
const ShowHighlightPopoverEffect = StateEffect.define<{ from: number; to: number }>();
const ShowStrikethroughPopoverEffect = StateEffect.define<{ from: number; to: number }>();


// --- TYPE DEFINITIONS ---
interface Match {
	from: number;
	to: number;
	text: string;
	comment?: string;
	fullMatch: string;
	hasComment: boolean;
}

interface HighlightMatch extends Match {
	hasColor: boolean;
}

interface StrikethroughMatch extends Match {}


// --- BASE WIDGET CLASS ---
abstract class BaseWidget extends WidgetType {
	view: EditorView | null = null;
	wrapperEl?: HTMLElement;

	constructor(
		protected text: string,
		protected comment: string | undefined,
		protected from: number,
		protected to: number,
		protected hasComment: boolean,
	) {
		super();
	}

	abstract eq(other: BaseWidget): boolean;
	abstract toDOM(view: EditorView): HTMLElement;
	abstract renderPopoverContent(): void;

    // --- Logic to close popover on any keydown event ---
    
    // Arrow function to preserve 'this' context when used as an event listener.
    private popoverKeydownHandler = (evt: KeyboardEvent) => {
        // If the user is typing inside the comment box, let them.
        // The React component handles its own key events (like Enter for submit).
        if (evt.target instanceof HTMLTextAreaElement) {
            return;
        }
        // For any other key press, hide the popover. This will trigger the 'close' event.
        getPopover()?.hidePopover();
    };

    // Arrow function to preserve 'this' context. This is the cleanup function.
    private cleanupPopoverListeners = () => {
        document.removeEventListener('keydown', this.popoverKeydownHandler, true);
    };

	protected positionPopover() {
		const popover = getPopover();
		if (!popover || !this.wrapperEl) return;

		const rect = this.wrapperEl.getBoundingClientRect();
		const popoverRect = popover.getBoundingClientRect();
		const centerOffset = (rect.width - popoverRect.width) / 2;

		popover.style.top = `${rect.bottom + window.scrollY + 10}px`;
		popover.style.left = `${rect.left + window.scrollX + centerOffset}px`;

		if (rect.left + popoverRect.width > window.innerWidth) {
			popover.style.left = `${window.innerWidth - popoverRect.width}px`;
		}
	}
	
	public showPopover() {
		if (!this.view || !this.wrapperEl) return;

        // Clean up any previous listeners just in case.
        this.cleanupPopoverListeners();

		this.renderPopoverContent();
		this.positionPopover();

        const popover = getPopover();
        if (!popover) return;
        
        // Add listeners for the current popover instance.
        popover.addEventListener('close', this.cleanupPopoverListeners, { once: true });
        document.addEventListener('keydown', this.popoverKeydownHandler, true);

		popover.showPopover();

		setTimeout(() => {
			const textarea = popover.querySelector("textarea") as HTMLTextAreaElement;
			if (textarea) {
				textarea.focus();
				textarea.setSelectionRange(textarea.value.length, textarea.value.length);
			}
		}, 50);
	}
    
	protected handleRemoval() {
		if (!this.view) return;
		const transaction = this.view.state.update({
			changes: { from: this.from, to: this.to, insert: this.text },
		});
		this.view.dispatch(transaction);
	}

	protected handleUpdate(newComment: string, startTag: string, endTag: string) {
		if (!this.view) return;
		const newText = newComment.trim() === ""
			? `${startTag}${this.text}${endTag}`
			: `${startTag}${this.text}${endTag}<!--${newComment}-->`;
		
		const transaction = this.view.state.update({
			changes: { from: this.from, to: this.to, insert: newText },
		});
		this.view.dispatch(transaction);
	}
}

// --- HIGHLIGHT WIDGET ---
class HighlightWidget extends BaseWidget {
	constructor(
		text: string,
		comment: string | undefined,
		from: number,
		to: number,
		hasComment: boolean,
		private hasColor: boolean,
		private colorOptions: string[],
	) {
		super(text, comment, from, to, hasComment);
	}

	eq(other: HighlightWidget) {
		return this.text === other.text && this.comment === other.comment && this.from === other.from && this.to === other.to && this.hasComment === other.hasComment && this.hasColor === other.hasColor;
	}

	toDOM(view: EditorView) {
		this.view = view;
		this.wrapperEl = document.createElement("span");
		this.wrapperEl.className = this.hasComment ? "perink-highlight has-comment" : "perink-highlight";
		if (this.hasColor) this.wrapperEl.classList.add("has-color");
		this.wrapperEl.textContent = this.text;
		if (this.comment) this.wrapperEl.title = this.comment;
		this.setHighlightColor(this.comment);

		this.wrapperEl.addEventListener("click", () => this.showPopover());
		return this.wrapperEl;
	}

	renderPopoverContent() {
		const popover = getPopover();
		if (!popover) return;

		let initialComment = this.comment || "";
		const initialColor = matchColor(initialComment);
		initialComment = initialComment.replace(`@${initialColor}`, "").trim();

		root.render(
			<CommentPopover
				className="perink-comment-popover"
				initialComment={initialComment}
				key={Math.random()}
				colorOptions={this.colorOptions}
				highlightText={this.text}
				onSave={({ comment, remove }) => {
					if (remove) this.handleRemoval();
					else if (typeof comment !== "undefined") this.handleUpdate(comment, "==", "==");
				}}
				popoverRef={popover}
			/>
		);
	}

	private setHighlightColor(comment?: string) {
		if (!this.wrapperEl) return;
		const matchedColor = comment ? matchColor(comment) : null;
		this.wrapperEl.style.backgroundColor = matchedColor || "var(--text-highlight-bg)";
	}

	protected handleUpdate(newComment: string, startTag: string, endTag: string) {
        super.handleUpdate(newComment, startTag, endTag);
        this.setHighlightColor(newComment);
    }
}

// --- STRIKETHROUGH WIDGET ---
class StrikethroughWidget extends BaseWidget {
	eq(other: StrikethroughWidget) {
		return this.text === other.text && this.comment === other.comment && this.from === other.from && this.to === other.to && this.hasComment === other.hasComment;
	}

	toDOM(view: EditorView) {
		this.view = view;
		this.wrapperEl = document.createElement("span");
		this.wrapperEl.className = "perink-strikethrough";
		if(this.hasComment) this.wrapperEl.classList.add("has-comment");
		
		// Wrap the text in an inner span to allow for separate text-decoration styling.
		const innerTextSpan = document.createElement("span");
		innerTextSpan.textContent = this.text;
		this.wrapperEl.appendChild(innerTextSpan);

		if (this.comment) this.wrapperEl.title = this.comment.trim();

		this.wrapperEl.addEventListener("click", () => this.showPopover());
		return this.wrapperEl;
	}

	renderPopoverContent() {
		const popover = getPopover();
		if (!popover) return;
		root.render(
			<StrikethroughPopover
				className="perink-strikethrough-popover"
				initialComment={this.comment}
				key={Math.random()}
				strikethroughText={this.text}
				onSave={({ comment, remove }) => {
					if (remove) this.handleRemoval();
					else if (typeof comment !== "undefined") this.handleUpdate(comment, "~~", "~~");
				}}
				popoverRef={popover}
			/>
		);
	}
}



// --- REGEX & PARSING ---
function findMatches<T extends Match>(doc: Text, regex: RegExp, constructor: (match: RegExpExecArray) => T): T[] {
    const matches: T[] = [];
    const docText = doc.toString();
    let m;
    while ((m = regex.exec(docText)) !== null) {
        matches.push(constructor(m));
    }
    return matches;
}

function createDecorations(state: EditorState, colorOptions: string[]): DecorationSet {
	const decorations: Range<Decoration>[] = [];
	
	// Highlights
	const highlightMatches = findMatches<HighlightMatch>(state.doc, /==(.*?)==(?:<!--(.*?)-->)?/gs, (m) => ({
		from: m.index,
		to: m.index + m[0].length,
		text: m[1],
		comment: m[2],
		fullMatch: m[0],
		hasComment: !!m[2] && m[2].trim() !== `@${matchColor(m[2])}`,
		hasColor: !!m[2] && matchColor(m[2]) !== null,
	}));

	// Strikethroughs
	const strikethroughMatches = findMatches<StrikethroughMatch>(state.doc, /~~(.*?)~~(?:<!--(.*?)-->)?/gs, (m) => ({
		from: m.index,
		to: m.index + m[0].length,
		text: m[1],
		comment: m[2],
		fullMatch: m[0],
		hasComment: !!m[2] && m[2].trim() !== "",
	}));

	for (const match of highlightMatches) {
		decorations.push(Decoration.replace({
			widget: new HighlightWidget(match.text, match.comment, match.from, match.to, match.hasComment, match.hasColor, colorOptions),
		}).range(match.from, match.to));
	}

	for (const match of strikethroughMatches) {
		decorations.push(Decoration.replace({
			widget: new StrikethroughWidget(match.text, match.comment, match.from, match.to, match.hasComment),
		}).range(match.from, match.to));
	}

	return Decoration.set(decorations, true);
}


// --- CODEMIRROR EXTENSION ---
export function highlightExtension(colorOptions: string[]): Extension {
	const decorationStateField = StateField.define<DecorationSet>({
		create(state) {
			return state.field(editorLivePreviewField) ? createDecorations(state, colorOptions) : Decoration.none;
		},
		update(decorations, transaction) {
			const isLivePreview = transaction.state.field(editorLivePreviewField);
			if (!isLivePreview) return Decoration.none;

			if (transaction.docChanged || transaction.startState.field(editorLivePreviewField) !== isLivePreview) {
				return createDecorations(transaction.state, colorOptions);
			}
			return decorations.map(transaction.changes);
		},
		provide: (f) => EditorView.decorations.from(f),
	});

	const popoverPlugin = ViewPlugin.fromClass(
		class {
			update(update: ViewUpdate) {
				const effect = update.transactions[0]?.effects.find(e => e.is(ShowHighlightPopoverEffect) || e.is(ShowStrikethroughPopoverEffect));
				if (!effect) return;

				const { from, to } = effect.value;
				const decorations = update.state.field(decorationStateField);
				decorations.between(from, to, (_, __, deco) => {
					const widget = deco.spec.widget;
					if (widget instanceof BaseWidget) {
						setTimeout(() => widget.showPopover(), 0);
						return false; // Stop iterating
					}
				});
			}
		}
	);

	return [decorationStateField, popoverPlugin];
}


// --- PUBLIC COMMANDS ---
function createMark(
    view: EditorView,
    startTag: "==" | "~~",
    endTag: "==" | "~~",
    effectType?: StateEffectType<{ from: number; to: number; }>
){
	const selection = view.state.selection.main;
	if (selection.empty) return false;

	const selectedText = view.state.doc.sliceString(selection.from, selection.to);
	const markText = `${startTag}${selectedText}${endTag}`;
    
    const effects = effectType ? [effectType.of({ from: selection.from, to: selection.from + markText.length })] : [];

	const transaction = view.state.update({
		changes: { from: selection.from, to: selection.to, insert: markText },
		effects,
	});

	view.dispatch(transaction);
	return true;
}

export function createHighlight(view: EditorView) {
	return createMark(view, "==", "==", ShowHighlightPopoverEffect);
}

export function createStrikethrough(view: EditorView) {
	return createMark(view, "~~", "~~", ShowStrikethroughPopoverEffect);
}

export function applyStrikethroughWithoutPopover(view: EditorView) {
    return createMark(view, "~~", "~~");
}

export function cleanup() {
	root.unmount();
	popoverContainerEl.remove();
}

export function getPopover() {
	return document.getElementById("perink-comment-popover-container");
}