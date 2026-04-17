import { useState, useRef, useEffect, type CSSProperties } from "react";
import { setIcon, Notice } from "obsidian";
import { cn } from "@/lib/utils";
import { matchColor } from "@/lib/utils";

// --- Type Declarations ---
declare module "react" {
	interface HTMLAttributes<T> extends AriaAttributes, DOMAttributes<T> {
		popover?: "" | "auto" | "manual";
	}
}

interface PopoverProps {
	type: 'highlight' | 'strikethrough';
	initialComment: string;
	textToCopy: string;
	onSave: (fullComment: string) => void;
	onRemove: () => void;
	popoverRef: HTMLElement;
	colorOptions: string[];
}

// --- Helper Components ---
const PopoverButton = ({ icon, title, onClick, style }: { icon: string; title: string; onClick: () => void; style?: CSSProperties }) => {
    const buttonRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (buttonRef.current) setIcon(buttonRef.current, icon);
    }, [icon]);

    return (
        <button type="button" onClick={onClick} className="clickable-icon" ref={buttonRef} title={title} style={style}>
            <span className="sr-only">{title}</span>
        </button>
    );
};

// --- Main Popover Component ---
export default function CommentPopover({
	type,
	initialComment,
	textToCopy,
	onSave,
	onRemove,
	popoverRef,
	colorOptions,
}: PopoverProps) {
	// --- State Management ---
    // Separate state for the user-typed text and the selected color
	const [commentText, setCommentText] = useState("");
	const [selectedColor, setSelectedColor] = useState<string | null>(null);
	const [showCommentForm, setShowCommentForm] = useState(false);
	const inputRef = useRef<HTMLTextAreaElement>(null);

	// --- Array of blob class names to cycle through ---
	const blobClasses = ["perink-blob-1", "perink-blob-2", "perink-blob-3", "perink-blob-4", "perink-blob-5", "perink-blob-6"];
	// A stable set of rotations to make the layout feel less grid-like
	const rotations = [5, -10, 15, -5, 10, -15, 8, -3];

	// Parse the initial comment on mount to populate the state
	useEffect(() => {
		const color = matchColor(initialComment);
		const text = initialComment.replace(` @${color}`, "").trim();
		setCommentText(text);
		setSelectedColor(color);
		// Show the comment form if there's text or if it's a highlight (to show colors)
		if (text || type === 'highlight' || type == 'strikethrough') {
			setShowCommentForm(true);
		}
	}, [initialComment, type]);

    // --- Actions ---
	const hidePopover = () => popoverRef.hidePopover();

    /**
     * Commits the changes by constructing the full comment string from the
     * current state and calling the onSave prop.
     * @param text The text part of the comment.
     * @param color The color part of the comment.
     */
	const commitChanges = (text: string, color: string | null) => {
		if (text.includes("-->") || text.includes("\n\n")) {
			new Notice("Comment cannot contain '-->' or empty lines.");
			return;
		}
		hidePopover();
		const fullComment = (text.trim() + (color ? ` @${color}` : ""));
		onSave(fullComment);
	};

	// Focus the textarea when it becomes visible
	useEffect(() => {
		if (showCommentForm && inputRef.current) {
			inputRef.current.focus();
			const len = inputRef.current.value.length;
			inputRef.current.setSelectionRange(len, len);
		}
	}, [showCommentForm]);


	return (
		<div className={cn("perink-popover", "rounded-lg border border-solid border-gray-200 p-0 shadow-lg")} style={{ backgroundColor: "var(--background-primary)" }}>
			{/* --- Header --- */}
			<div className="flex justify-between items-center p-1" style={{ borderBottom: "1px solid var(--background-modifier-border)" }}>
				<PopoverButton 
					icon="eraser" 
					title="Remove annotation" 
					onClick={() => { hidePopover(); onRemove(); }} 
					style={{ color: "var(--color-red)" }}
				/>
				<div className="flex items-center">
					<PopoverButton icon="clipboard" title="Copy to clipboard" onClick={() => { navigator.clipboard.writeText(textToCopy); new Notice("Copied to clipboard"); hidePopover(); }} />
					{!showCommentForm && <PopoverButton icon="square-pen" title="Add comment" onClick={() => setShowCommentForm(true)} />}
					<PopoverButton icon="x" title="Close" onClick={hidePopover} />
				</div>
			</div>

			{/* --- Body (Conditional) --- */}
			{showCommentForm && (
				<div className="p-2">
					{/* --- Color Palette (Highlights Only) --- */}
					{type === 'highlight' && (
                        // --- FIX: Wrap blobs in the new palette container ---
						<div className="perink-palette-container mb-2">
                            <div className="flex flex-wrap items-center justify-center">
                                <div
                                    onClick={() => commitChanges(commentText, null)}
                                    style={{ backgroundColor: "var(--text-highlight-bg)" }}
                                    className={cn("perink-color-blob", "rounded-full" )}
                                    title="Default color"
                                />
                                {colorOptions.map((color, index) => (
                                    <div
                                        key={color}
                                        onClick={() => commitChanges(commentText, color)}
                                        // --- FIX: Apply dynamic rotation and cycled blob classes ---
                                        style={{ 
                                            backgroundColor: color,
                                            transform: `rotate(${rotations[index % rotations.length]}deg)`
                                        }}
                                        className={cn("perink-color-blob", blobClasses[index % blobClasses.length])}
                                        title={color}
                                    />
                                ))}
                            </div>
						</div>
					)}

					<textarea
						ref={inputRef}
						value={commentText}
						onChange={(e) => setCommentText(e.target.value)}
						className="w-full resize-none rounded-none border-none p-0 !shadow-none"
						rows={4}
						placeholder="Add a note... (Enter to save)"
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								// Save with the current text and color state
								commitChanges(commentText, selectedColor);
							}
						}}
					/>
				</div>
			)}
		</div>
	);
}