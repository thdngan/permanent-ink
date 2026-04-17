import { useRef, useEffect, type CSSProperties } from "react";
import { setIcon } from "obsidian";
import { cn } from "@/lib/utils";
import { ResizableBox } from 'react-resizable';

// --- Type Declarations ---
declare module "react" {
	interface HTMLAttributes<T> extends AriaAttributes, DOMAttributes<T> {
		popover?: "" | "auto" | "manual";
	}
}

interface PopoverProps {
	commentText: string;
	onCommentChange: (newText: string) => void;
	textToCopy: string;
	onCopy: () => void;
	onRemove: () => void;
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
	commentText,
	onCommentChange,
	onCopy,
	onRemove,
}: PopoverProps) {
	const inputRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		if (inputRef.current) {
			inputRef.current.focus();
			const len = inputRef.current.value.length;
			inputRef.current.setSelectionRange(len, len);
		}
	}, []);

	return (
		<ResizableBox
			className="perink-popover-resizable-box"
			width={280}
			height={150}
			minConstraints={[200, 120]}
			maxConstraints={[600, 400]}
			axis="both"
			handleSize={[10, 10]}
		>
			<div className={cn("perink-popover flex h-full w-full flex-col rounded-lg border border-solid p-0 shadow-lg")} style={{ backgroundColor: "var(--background-primary)" }}>
				{/* ADD 'perink-popover-drag-handle' CLASS HERE */}
				<div className="perink-popover-drag-handle flex w-full items-center gap-2 p-1 pl-2" style={{ borderBottom: "1px solid var(--background-modifier-border)" }}>
					<div className="flex-grow text-xs text-muted">Annotation</div>
					<div className="flex items-center">
						<PopoverButton icon="clipboard" title="Copy selection to clipboard" onClick={onCopy} />
						<PopoverButton 
							icon="eraser" 
							title="Remove annotation" 
							onClick={onRemove} 
							style={{ color: "var(--color-red)" }}
						/>
					</div>
				</div>

				<div className="flex-grow p-2">
					<textarea
						ref={inputRef}
						value={commentText}
						onChange={(e) => onCommentChange(e.target.value)}
						className="h-full w-full resize-none rounded-none border-none p-0 !shadow-none"
						placeholder="Type a note..."
					/>
				</div>
			</div>
		</ResizableBox>
	);
}