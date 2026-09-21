import { Facet } from "@codemirror/state";
import { type EditorView, WidgetType } from "@codemirror/view";
import { Component, editorInfoField, setIcon } from "obsidian";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import Draggable from "react-draggable";
import { noteMarker, type NoteStore } from "@/notes";
import { unifiedPopoverContainerEl, unifiedPopoverRoot } from "./popover-root";

// The store is handed to the editor extension by the plugin, since widgets have no other way
// to reach the vault.
export const noteStoreFacet = Facet.define<NoteStore, NoteStore | null>({
	combine: values => values[0] ?? null,
});

// --- PIN WIDGET ---
export class NoteWidget extends WidgetType {
	constructor(readonly id: string) {
		super();
	}

	// CodeMirror reuses the pin's DOM whenever this is true, so it must not depend on where the
	// marker currently sits. Everything the pin does looks the note up by id instead.
	eq(other: NoteWidget): boolean {
		return other.id === this.id;
	}

	toDOM(view: EditorView): HTMLElement {
		const pin = createSpan({ cls: "perink-note-pin", attr: { "data-note-id": this.id, "aria-label": "Note" } });
		setIcon(pin, "sticky-note");
		pin.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			showNotePopover(view, this.id);
		});
		return pin;
	}
}

let popoverKey = 0;

export function showNotePopover(view: EditorView, id: string) {
	const store = view.state.facet(noteStoreFacet);
	const docPath = view.state.field(editorInfoField, false)?.file?.path;
	const anchorEl = view.contentDOM.querySelector<HTMLElement>(`.perink-note-pin[data-note-id="${id}"]`);
	if (!store || !docPath || !anchorEl) return;

	unifiedPopoverRoot.render(
		<NotePopover
			// A fresh key per opening, so a note never inherits the state of the one before it.
			key={++popoverKey}
			anchorEl={anchorEl}
			store={store}
			docPath={docPath}
			id={id}
			popoverEl={unifiedPopoverContainerEl}
			onDelete={() => removeNote(view, store, docPath, id)}
		/>
	);
	if (!unifiedPopoverContainerEl.matches(":popover-open")) unifiedPopoverContainerEl.showPopover();
}

export function removeNote(view: EditorView, store: NoteStore, docPath: string, id: string) {
	// Found by id rather than by a stored position, which may be out of date by now.
	const marker = noteMarker(id);
	const from = view.state.doc.toString().indexOf(marker);
	if (from !== -1) view.dispatch({ changes: { from, to: from + marker.length } });
	void store.remove(id, docPath);
}

// --- RENDERED MARKDOWN ---
// Renders a note with Obsidian's own markdown renderer, so it looks like any other note,
// embeds and all, and makes its internal links work.
export function RenderedMarkdown({ store, markdown, sourcePath, className }: {
	store: NoteStore;
	markdown: string;
	sourcePath: string;
	className?: string;
}) {
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		el.empty();
		// Owns whatever the renderer attaches (embeds, live children), released on cleanup.
		const component = new Component();
		component.load();
		void store.render(markdown, el, sourcePath, component);
		return () => component.unload();
	}, [store, markdown, sourcePath]);

	// A click on a link follows the link and nothing else.
	const onMouseDown = (event: ReactMouseEvent) => {
		if ((event.target as HTMLElement).closest("a")) event.stopPropagation();
	};
	const onClick = (event: ReactMouseEvent) => {
		const link = (event.target as HTMLElement).closest("a");
		if (!link) return;
		event.stopPropagation();
		if (link.classList.contains("internal-link")) {
			event.preventDefault();
			const target = link.getAttribute("data-href") ?? link.getAttribute("href") ?? "";
			store.openLink(target, sourcePath, event.ctrlKey || event.metaKey);
		}
	};

	return (
		<div
			ref={ref}
			className={`markdown-rendered ${className ?? ""}`}
			onMouseDown={onMouseDown}
			onClick={onClick}
		/>
	);
}

// --- ICON BUTTON ---
// Labelled with a native title rather than aria-label. Obsidian draws its own tooltip for
// aria-label, and that tooltip sits below the popover, which lives in the browser's top layer.
export function IconButton({ icon, label, onClick, className }: {
	icon: string;
	label: string;
	onClick: () => void;
	className?: string;
}) {
	const ref = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		if (ref.current) setIcon(ref.current, icon);
	}, [icon]);
	return (
		<button
			ref={ref}
			className={`clickable-icon ${className ?? ""}`}
			title={label}
			onMouseDown={(event) => {
				// Neither steal focus nor count as a click on whatever card the button sits in.
				event.preventDefault();
				event.stopPropagation();
			}}
			onClick={(event) => {
				event.stopPropagation();
				onClick();
			}}
		/>
	);
}

// --- NOTE POPOVER ---
// Read only: the note is shown rendered, and its text can be selected and copied like in
// reading view. Writing happens in the note's own tab.
interface NotePopoverProps {
	anchorEl: HTMLElement;
	store: NoteStore;
	docPath: string;
	id: string;
	popoverEl: HTMLElement;
	onDelete: () => void;
}

const POPOVER_WIDTH = 340;

function NotePopover({ anchorEl, store, docPath, id, popoverEl, onDelete }: NotePopoverProps) {
	const [content, setContent] = useState(() => store.peek(id));
	const [position] = useState(() => {
		const rect = anchorEl.getBoundingClientRect();
		const x = rect.left + window.scrollX + rect.width / 2 - POPOVER_WIDTH / 2;
		const maxX = window.innerWidth - POPOVER_WIDTH - 8;
		return { x: Math.max(8, Math.min(x, maxX)), y: rect.bottom + window.scrollY + 6 };
	});

	// Loads the note, and follows it as it is edited in its own tab.
	useEffect(() => {
		let alive = true;
		void store.read(id, docPath).then((text) => { if (alive) setContent(text); });
		const unsubscribe = store.subscribe(() => setContent(store.peek(id)));
		return () => {
			alive = false;
			unsubscribe();
		};
	}, [store, docPath, id]);

	const open = () => {
		void store.open(id, docPath);
		popoverEl.hidePopover();
	};

	const remove = () => {
		onDelete();
		popoverEl.hidePopover();
	};

	return (
		<Draggable handle=".perink-note-popover-header" cancel="button" defaultPosition={position}>
			<div className="perink-draggable-container absolute cursor-default">
				<div className="perink-note-popover" style={{ width: POPOVER_WIDTH }}>
					<div className="perink-note-popover-header">
						<span className="perink-note-popover-title">Note</span>
						<IconButton icon="pencil" label="Open note in a new tab" onClick={open} />
						<IconButton icon="trash-2" label="Delete note" onClick={remove} />
					</div>
					<div className="perink-note-popover-body">
						{content === undefined ? null : content.trim()
							? <RenderedMarkdown store={store} markdown={content} sourcePath={store.sourcePathFor(id, docPath)} />
							: <div className="perink-note-empty">Empty note. Open it in a new tab to write.</div>}
					</div>
				</div>
			</div>
		</Draggable>
	);
}
