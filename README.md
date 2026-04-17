# Permanent Ink

*Every word counts.*

---

## What is this?

In the age of digital perfection, we often lose the messy, authentic process of thinking and writing. Every backspace erases not just letters, but the story of how an idea came to be.

Permanent Ink turns your Obsidian editor into a canvas where thoughts layer upon each other. When you hit Backspace or Delete, words don't vanish, they get crossed out, creating a visible record of your mind at work.

Picture this: you're writing and type "she walked nervously" but then change it to "she paced." With Permanent Ink, you get `she ~~walked nervously~~ paced`. The evolution preserved. Your false starts become your marginalia.

This plugin was built on top of ideas from [jancbeck/obsidian-note-annotations](https://github.com/jancbeck/obsidian-note-annotations). What started as a few personal modifications grew into something different enough to live on its own.

---

## Features

### Restricted writing mode

The core of the plugin. When active (shown as **Permanent Ink: ON** in your status bar), the editor enforces a write-forward discipline:

- **Backspace and Delete apply strikethroughs** instead of erasing. Selecting text and pressing either key wraps the selection in `~~strikethrough~~`.
- **New text always goes to the end.** Typing mid-document moves your cursor to the last line first. If you're inside a recognized delimiter pair at the document's end (like parentheses or brackets), the cursor jumps to just before the closing character instead.
- **Undo and Cut are blocked.** `Ctrl/Cmd+Z` and `Ctrl/Cmd+X` do nothing in restricted mode.
- **No mid-document line breaks.** Pressing Enter only works at the very end of the document.
- **Cursor navigation is annotation-aware.** Arrow keys skip over highlight and strikethrough blocks atomically, so you never land inside the `==` or `~~` markers.

Toggle the mode by clicking the status bar item or running the **Toggle editing mode** command.

### Highlights

Select any text and press `H` (or use the **Highlight selection** command) to wrap it in `==highlight==`.

In the live preview editor, highlights render as colored spans. Clicking one opens a popover where you can:

- Pick a color from the palette
- Write a comment (stored as `==text==<!--your comment @colorname-->`)
- Copy the highlighted text to your clipboard
- Remove the highlight entirely

The color palette options are configurable in the plugin settings.

### Strikethroughs

Select text and press Backspace, Delete, or use the **Strikethrough selection** command to wrap it in `~~strikethrough~~`.

Like highlights, clicking a strikethrough in live preview opens the same popover, where you can attach a comment or remove it.

### Selection popup

Whenever you select text with your mouse or finger, a small floating toolbar appears near the selection with two options:

- **Cross out** — applies a strikethrough
- **Highlight** — applies a highlight

The popup is draggable. You can also use keyboard shortcuts (`H` for highlight, `Backspace`/`Delete` for strikethrough) while it's open.

### Annotations sidebar

Click the quote icon in the ribbon to open a sidebar panel listing every highlight and strikethrough in the current document.

Each card shows the annotated text, its type, and any attached comment. Clicking a card scrolls the editor to that annotation and briefly flashes a border around it. From the card you can:

- Edit the attached comment inline
- Remove the annotation (replacing it with plain text)

The sidebar updates automatically as you edit.

### Quad indentation

A lightweight indentation system built for restricted mode. On the last line of the document, pressing `Tab` inserts a `$\quad$ ` block at the start of the line (rendered as indentation in the editor). Pressing Tab again adds another `\quad` to deepen it.

In restricted mode, Backspace and arrow keys are aware of these blocks and skip over them cleanly rather than landing the cursor inside the LaTeX syntax.

### Reading mode support

Highlights and strikethroughs with comments render correctly in Obsidian's reading view. The color is applied as a background, and hovering over an annotated word shows the comment as a tooltip.

---

## Installation

1. Download the plugin files.
2. Place them in `.obsidian/plugins/permanent-ink/` inside your vault.
3. Enable the plugin under **Settings → Community Plugins**.
4. **Permanent Ink: ON** will appear in your status bar.

---

## Configuration

Open **Settings → Permanent Ink** to adjust:

**Expand selection**: when enabled, highlight and strikethrough commands automatically expand the selection to cover complete words. This prevents broken markdown rendering from partial-word selections. Hold `Alt` while selecting to override this on the fly.

**Highlighting color options**: a comma-separated list of [CSS color names](https://147colors.com) that appear in the color palette. Requires an app reload to take effect.

---

## How Restricted Mode handles keys

| Key | Behavior |
|---|---|
| Typing | Moves cursor to end of document, then types normally |
| `Backspace` / `Delete` | Applies strikethrough to selection or nearest word |
| `Tab` | Adds `$\quad$` indentation on the last line |
| `Enter` | Blocked unless cursor is at the very end of the document |
| `Ctrl/Cmd+Z` | Blocked |
| `Ctrl/Cmd+X` | Blocked |
| Arrow keys | Navigation, with smart skipping around annotation blocks and quad indentation |

---

## A Note on Writing

*"The first draft of anything is shit."* — Ernest Hemingway.

Maybe that's exactly why we should keep it around.