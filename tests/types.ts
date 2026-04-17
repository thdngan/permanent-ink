import { TextMarker } from "codemirror";

export const ANNOTATION_VIEW_TYPE = "permanent-ink-annotation-view";

export interface Annotation {
    id: string;
    filePath: string;
    marker: TextMarker;
    inserted: string; // The character that was typed
    annotated: string | null; // The text that was selected, or null for an insertion
}
