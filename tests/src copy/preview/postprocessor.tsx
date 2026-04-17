import type { MarkdownPostProcessorContext } from "obsidian";
import CommentRenderer from "./note";
import { matchColor } from "@/lib/utils";

export default (
	element: HTMLElement,
	{ getSectionInfo, addChild }: MarkdownPostProcessorContext
) => {
	const section = getSectionInfo(element);
	if (!section) return;

	const unprocessedText = section.text;
	let counter = 0;

	// --- Process Highlights ---
	const highlightRegex = /==(.*?)==<!--(.*?)-->/g;
	const marks = element.findAll("mark");
	if (marks.length) {
		const highlightMatches = Array.from(unprocessedText.matchAll(highlightRegex));

		for (const mark of marks) {
			const matchIndex = highlightMatches.findIndex(m => m[1] === mark.innerText);
			if (matchIndex === -1) continue;
			
			const match = highlightMatches[matchIndex];
			highlightMatches.splice(matchIndex, 1);

			mark.addClass("perink-highlight");
			const comment = match[2];
			const matchedColor = matchColor(comment);
			const cleanComment = comment.trim().replace(`@${matchedColor ?? ""}`, "").trim();

			if (cleanComment) {
				mark.setAttribute("title", cleanComment);
				mark.addClass("has-comment");
				element.addClass("relative");

				if (matchedColor) mark.style.backgroundColor = matchedColor;

				addChild(new CommentRenderer(element, cleanComment, counter % 2 ? "left" : "right", mark, matchedColor));
				counter++;
			}
		}
	}

	// --- Process Strikethroughs ---
	const strikethroughRegex = /~~(.*?)~~<!--(.*?)-->/g;
	const dels = element.findAll("del");
	if (dels.length) {
		const strikethroughMatches = Array.from(unprocessedText.matchAll(strikethroughRegex));

		for (const del of dels) {
			const matchIndex = strikethroughMatches.findIndex(m => m[1] === del.innerText);
			if (matchIndex === -1) continue;

			const match = strikethroughMatches[matchIndex];
			strikethroughMatches.splice(matchIndex, 1);
			
			del.addClass("perink-strikethrough");
			const cleanComment = match[2].trim();

			if (cleanComment) {
				del.setAttribute("title", cleanComment);
				del.addClass("has-comment");
				element.addClass("relative");

				addChild(new CommentRenderer(element, cleanComment, counter % 2 ? "left" : "right", del, null));
				counter++;
			}
		}
	}
};