import { type App, type CachedMetadata, type Component, getFrontMatterInfo, MarkdownRenderer, normalizePath, TFile, type TAbstractFile } from "obsidian";

// A note is anchored in the document by an invisible marker, and its content lives in its own
// markdown file inside a folder that belongs to that document:
//
//   journal/Nghi's journal.md          ... puis Marco, Lyra<!--note:m1x2k9ab--> et moi ...
//   journal/Nghi's journal notes/Note 1.md
//
// The marker and the file are tied together by an id in the note's frontmatter, not by the
// file's name or location, so the note can be renamed or moved freely without losing its pin:
//
//   ---
//   perink-note: m1x2k9ab
//   ---
//   The note itself, as long and as rich as any markdown file.
export const NOTE_MARKER_REGEX = /<!--note:([a-z0-9]+)-->/g;
const NOTE_ID_KEY = "perink-note";

export function noteMarker(id: string): string {
	return `<!--note:${id}-->`;
}

/** A note's text without its frontmatter, which only holds the id. */
function noteBody(content: string): string {
	const info = getFrontMatterInfo(content);
	return info.exists ? content.slice(info.contentStart).replace(/^\n+/, "") : content;
}

export class NoteStore {
	// Note bodies by id. An empty string also stands for a note whose file is missing.
	private cache = new Map<string, string>();
	// Where each note lives, by id. Built from the frontmatter of every file on first use.
	private index: Map<string, string> | null = null;
	private listeners = new Set<() => void>();

	constructor(private app: App) {}

	folderFor(docPath: string): string {
		const slash = docPath.lastIndexOf("/");
		const dir = slash === -1 ? "" : docPath.slice(0, slash + 1);
		const basename = docPath.slice(slash + 1).replace(/\.md$/, "");
		return normalizePath(`${dir}${basename} notes`);
	}

	newId(): string {
		// Time based so ids sort in creation order, plus a random tail so two notes added in
		// the same millisecond still differ.
		return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
	}

	/** The file holding a note, wherever it has been moved to and whatever it is called. */
	find(id: string, docPath: string): TFile | null {
		const path = this.getIndex().get(id);
		const file = path ? this.app.vault.getFileByPath(path) : null;
		if (file) return file;
		// Notes from the first version of this feature were named after their id and had no
		// frontmatter, so still look for those.
		return this.app.vault.getFileByPath(normalizePath(`${this.folderFor(docPath)}/${id}.md`));
	}

	/** Whether a file is a note, going by the id in its frontmatter. */
	isNoteFile(file: TFile | null): boolean {
		if (!file) return false;
		const id: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.[NOTE_ID_KEY];
		if (typeof id === "string") return true;
		// A note created a moment ago may not be in the metadata cache yet.
		return [...this.getIndex().values()].includes(file.path);
	}

	/** A note's body already loaded, without touching the disk. */
	peek(id: string): string | undefined {
		return this.cache.get(id);
	}

	async read(id: string, docPath: string): Promise<string> {
		const file = this.find(id, docPath);
		const body = file ? noteBody(await this.app.vault.cachedRead(file)) : "";
		this.remember(id, body);
		return body;
	}

	/** Creates the file for a new note, named "Note 1", "Note 2" and so on within the post's folder. */
	async create(id: string, docPath: string): Promise<TFile> {
		const folder = this.folderFor(docPath);
		if (!this.app.vault.getFolderByPath(folder)) await this.app.vault.createFolder(folder);

		let n = 1;
		while (this.app.vault.getAbstractFileByPath(normalizePath(`${folder}/Note ${n}.md`))) n++;
		const file = await this.app.vault.create(normalizePath(`${folder}/Note ${n}.md`), `---\n${NOTE_ID_KEY}: ${id}\n---\n\n`);

		// The metadata cache indexes the new file a moment later, so record it straight away.
		this.getIndex().set(id, file.path);
		this.remember(id, "");
		return file;
	}

	/** Opens a note in a new tab, which is where notes are written and edited. */
	async open(id: string, docPath: string): Promise<void> {
		const file = this.find(id, docPath) ?? await this.create(id, docPath);
		await this.app.workspace.getLeaf("tab").openFile(file);
	}

	async remove(id: string, docPath: string): Promise<void> {
		const file = this.find(id, docPath);
		// trashFile follows the user's "deleted files" setting (system trash, .trash, or delete).
		if (file) await this.app.fileManager.trashFile(file);
		this.cache.delete(id);
		this.index?.delete(id);

		const folder = this.app.vault.getFolderByPath(this.folderFor(docPath));
		if (folder && folder.children.length === 0) await this.app.fileManager.trashFile(folder);
		this.notify();
	}

	/** Where a note's own links should be resolved from. */
	sourcePathFor(id: string, docPath: string): string {
		return this.find(id, docPath)?.path ?? docPath;
	}

	async render(markdown: string, el: HTMLElement, sourcePath: string, component: Component): Promise<void> {
		await MarkdownRenderer.render(this.app, markdown, el, sourcePath, component);
	}

	openLink(linktext: string, sourcePath: string, newLeaf: boolean) {
		void this.app.workspace.openLinkText(linktext, sourcePath, newLeaf);
	}

	/** Called whenever a note's content changes, from the plugin or from outside it. */
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Keeps the index and the cache in step as files are edited, in the plugin's tab or anywhere. */
	onMetadataChanged(file: TFile, data: string, cache: CachedMetadata) {
		const id: unknown = cache.frontmatter?.[NOTE_ID_KEY];
		if (typeof id !== "string") return;
		this.getIndex().set(id, file.path);
		if (this.cache.has(id)) this.remember(id, noteBody(data));
	}

	onFileDeleted(file: TAbstractFile) {
		if (!this.index) return;
		for (const [id, path] of this.index) {
			if (path === file.path) {
				this.index.delete(id);
				this.remember(id, "");
			}
		}
	}

	/**
	 * Follows a note that was renamed or moved, and moves a document's notes folder along with
	 * the document when that is renamed or moved.
	 */
	async onFileRenamed(file: TAbstractFile, oldPath: string) {
		if (!(file instanceof TFile) || file.extension !== "md") return;

		if (this.index) {
			for (const [id, path] of this.index) {
				if (path === oldPath) this.index.set(id, file.path);
			}
		}

		const oldFolder = this.app.vault.getFolderByPath(this.folderFor(oldPath));
		const newFolderPath = this.folderFor(file.path);
		if (!oldFolder || oldFolder.path === newFolderPath) return;
		// Never merge into or overwrite a folder that already exists at the new name.
		if (this.app.vault.getAbstractFileByPath(newFolderPath)) return;

		// fileManager rather than vault, so links pointing into the notes are updated too. The
		// notes inside fire their own rename events, which keep the index right.
		await this.app.fileManager.renameFile(oldFolder, newFolderPath);
		this.notify();
	}

	private getIndex(): Map<string, string> {
		if (!this.index) {
			this.index = new Map();
			for (const file of this.app.vault.getMarkdownFiles()) {
				const id: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.[NOTE_ID_KEY];
				if (typeof id === "string") this.index.set(id, file.path);
			}
		}
		return this.index;
	}

	private remember(id: string, body: string) {
		if (this.cache.get(id) === body) return;
		this.cache.set(id, body);
		this.notify();
	}

	private notify() {
		for (const listener of this.listeners) listener();
	}
}
