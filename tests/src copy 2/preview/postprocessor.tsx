import type { MarkdownPostProcessorContext } from "obsidian";
import CommentRenderer from "./note";
import { matchColor } from "@/lib/utils";

const processAnnotationType = (
	element: HTMLElement,
	context: MarkdownPostProcessorContext,
	{ tag, className, regex, allowsColor }: { tag: "mark" | "del"; className: string; regex: RegExp; allowsColor: boolean; },
	counter: { value: number }
) => {
	const section = context.getSectionInfo(element);
	if (!section) return;

	const unprocessedText = section.text;
	const domElements = element.findAll(tag);
	if (!domElements.length) return;

	const textMatches = Array.from(unprocessedText.matchAll(regex));

	for (const domEl of domElements) {
		// Find the corresponding text match for the current DOM element
		const matchIndex = textMatches.findIndex(m => m[1] === domEl.innerText);
		if (matchIndex === -1) continue;

		const match = textMatches[matchIndex];
		textMatches.splice(matchIndex, 1); // Remove match to prevent re-use

		domEl.addClass(className);
		const commentText = match[2] || "";
		const matchedColor = allowsColor ? matchColor(commentText) : null;

		// --- Apply color styling regardless of whether a comment exists ---
		if (matchedColor) {
			domEl.style.backgroundColor = matchedColor;
		}

		const cleanComment = commentText.trim().replace(`@${matchedColor ?? ""}`, "").trim();

		if (cleanComment) {
			domEl.setAttribute("title", cleanComment);
			domEl.addClass("has-comment");
			element.addClass("relative"); // Parent needs to be relative for comment positioning
			
			const position = counter.value % 2 ? "left" : "right";
			context.addChild(new CommentRenderer(element, cleanComment, position, domEl, matchedColor));
			counter.value++;
		}
	}
};

export default (element: HTMLElement, context: MarkdownPostProcessorContext) => {
	const counter = { value: 0 };
	
	processAnnotationType(element, context, {
		tag: 'mark',
		className: 'perink-highlight',
		regex: /==(.*?)==<!--(.*?)-->/g,
		allowsColor: true
	}, counter);

	processAnnotationType(element, context, {
		tag: 'del',
		className: 'perink-strikethrough',
		regex: /~~(.*?)~~<!--(.*?)-->/g,
		allowsColor: false
	}, counter);
};