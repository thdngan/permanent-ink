import { useState, useRef, useEffect } from "react";
import { setIcon, Notice } from "obsidian";
import { cn } from "@/lib/utils";

interface StrikethroughPopoverProps {
	initialComment?: string;
	className: string;
	strikethroughText: string;
	onSave: ({
		comment,
		remove,
	}: {
		comment?: string;
		remove?: boolean;
	}) => void;
	popoverRef: HTMLElement;
}

declare module "react" {
	interface HTMLAttributes<T> extends AriaAttributes, DOMAttributes<T> {
		popover?: "" | "auto" | "manual";
	}
}

const StrikethroughPopover = ({
	initialComment = "",
	onSave,
	className,
	strikethroughText,
	popoverRef,
}: StrikethroughPopoverProps) => {
	const [comment, setComment] = useState(initialComment);
	const [showCommentForm, setShowCommentForm] = useState(comment !== "");
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const closeButtonRef = useRef<HTMLButtonElement>(null);
	const copyButtonRef = useRef<HTMLButtonElement>(null);
	const commentButtonRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (closeButtonRef.current) setIcon(closeButtonRef.current, "x");
	}, [showCommentForm]);

	useEffect(() => {
		if (closeButtonRef.current) setIcon(closeButtonRef.current, "x");
		if (copyButtonRef.current) setIcon(copyButtonRef.current, "clipboard");
		if (commentButtonRef.current) setIcon(commentButtonRef.current, "square-pen");
	}, []);

	const hidePopover = () => {
		popoverRef.hidePopover();
	};

	const handleSubmit = ({ remove }: { remove?: boolean }) => {
		if (comment.includes("-->")) {
			new Notice("Comment must not contain -->");
			return;
		}
		if (comment.includes("\n\n")) {
			new Notice("Comment must not contain empty lines");
			return;
		}
		hidePopover();
		onSave({
			comment: comment.trim(),
			remove,
		});
	};

	return (
		<div className={cn(className, "rounded-lg border border-solid border-gray-200 p-0 shadow-lg")}
                        style={{ backgroundColor: "var(--background-primary)" }}>
			<div className="flex justify-between" style={{ borderBottom: "1px solid var(--background-modifier-border)",
                                                        backgroundColor: "var(--background-primary)", }}>
				<button
					type="button"
					onClick={() => handleSubmit({ remove: true })}
					className={cn("flex !bg-transparent px-2 py-1 text-xs !shadow-none hover:bg-transparent hover:underline", showCommentForm ? "justify-around" : "justify-end")}
					style={{ color: "var(--color-red)" }}
				>
					Remove
				</button>
                <div className="flex justify-end">
				<div className="flex">
					<button
						type="button"
						onClick={() => {
							hidePopover();
							navigator.clipboard.writeText(strikethroughText);
							new Notice("Copied to clipboard");
						}}
						className="clickable-icon"
						ref={copyButtonRef}
						title="Copy to clipboard"
					>
						<span className="sr-only">Copy to clipboard</span>
					</button>

					{!showCommentForm && (
						<button
							type="button"
							onClick={() => {
								setShowCommentForm(true);
								setTimeout(() => {
									if (inputRef.current) {
										inputRef.current.focus();
										const length = inputRef.current.value.length;
										inputRef.current.setSelectionRange(length, length);
									}
								});
							}}
							className="clickable-icon"
							ref={commentButtonRef}
							title="Add comment"
						>
							<span className="sr-only">Add comment</span>
						</button>
					)}
				</div>
				{showCommentForm && (
					<button type="button" onClick={hidePopover} className="clickable-icon" ref={closeButtonRef}>
						<span className="sr-only">Close</span>
					</button>
				)}
                </div>
			</div>
			{showCommentForm && (
				<div className="p-2">
					<textarea
						ref={inputRef}
						value={comment}
						onChange={(e) => setComment(e.target.value)}
						className="mb-2 w-full resize-none rounded-none border-none p-0 !shadow-none"
						rows={5}
						placeholder="Add your note...&#13;&#10;and press Enter to save!"
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								handleSubmit({});
							}
						}}
					/>
				</div>
			)}
		</div>
	);
};

StrikethroughPopover.displayName = "StrikethroughPopover";

export default StrikethroughPopover;