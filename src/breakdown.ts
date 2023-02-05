/* eslint-disable @typescript-eslint/no-unnecessary-condition */
/* eslint-disable max-depth */
/* eslint-disable no-lonely-if */
import type { SMChart } from "./types";

export function CreateBreakdowns(
	notesPerMeasure: Array<number>,
	npsPerMeasure: Array<number>
): SMChart["breakdown"] {
	// No Streams?
	if (!notesPerMeasure.some((k) => k >= MIN_NOTES_TO_BE_CONSIDERED_STREAM)) {
		return null;
	}

	const partiallySimplified = calculateDetailed(notesPerMeasure, npsPerMeasure, "MEDIUM");

	return {
		detailed: calculateDetailed(notesPerMeasure, npsPerMeasure, "BASIC"),
		partiallySimplified,
		simplified: fullySimplify(partiallySimplified),
		total: calculateTotal(notesPerMeasure, npsPerMeasure),
		density: calculateDensity(notesPerMeasure),
	};
}

// BASIC -> only use `-` to indicate breaks one measure or less
// MEDIUM -> use `-` to indicate breaks between [0, 4], use / and | aswell
type MinLevel = "BASIC" | "MEDIUM";

// technically this is incorrect, but we have to filter out like, 8ths, somehow.
const MIN_NOTES_TO_BE_CONSIDERED_STREAM = 16;

function calculateDetailed(
	notesPerMeasure: Array<number>,
	npsPerMeasure: Array<number>,
	minimiseLevel: MinLevel
): string {
	let bd = "";

	let currentBreakSize = 0;

	let currentStreamSize = 0;

	// todo: indicate when bpms change in streams
	// this will fix current garbage output like "[26] The Vulture", etc.
	const currentStreamBPM = 0;

	let state: "BREAK" | "STREAM" = "BREAK";

	// these arrays are guaranteed to have same len
	for (const notes of notesPerMeasure) {
		if (notes >= MIN_NOTES_TO_BE_CONSIDERED_STREAM) {
			if (state === "BREAK") {
				state = "STREAM";

				// write the break if this isn't the first break in the file
				if (bd !== "") {
					if (minimiseLevel === "BASIC") {
						if (currentBreakSize <= 1) {
							bd = `${bd}-`;
						} else {
							bd = `${bd} (${currentBreakSize})`;
						}
					} else if (minimiseLevel === "MEDIUM") {
						if (currentBreakSize <= 4) {
							bd = `${bd}-`;
						} else if (currentBreakSize < 32) {
							bd = `${bd}/`;
						} else {
							bd = `${bd}|`;
						}
					}

					// reset break size
					currentBreakSize = 0;
				}
			}

			const streamMeasures = notes / MIN_NOTES_TO_BE_CONSIDERED_STREAM;

			currentStreamSize = currentStreamSize + streamMeasures;
		} else if (state === "STREAM") {
			// this stream has just ended
			state = "BREAK";

			// if the last char in the breakdown is )
			// add the string with whitespace
			if (/\)$/u.exec(bd)) {
				bd = `${bd} ${currentStreamSize.toFixed(0)}`;
			} else {
				// otherwise, it'll connect
				bd = `${bd}${currentStreamSize.toFixed(0)}`;
			}

			currentStreamSize = 0;
		} else {
			// this is a break that's continuing
			currentBreakSize = currentBreakSize + 1;
		}
	}

	return bd;
}

function fullySimplify(partiallySimplified: string): string {
	let outStr = "";

	let curStr = "";

	for (const char of partiallySimplified) {
		if (char === "|" || char === "/") {
			// join all - into one number
			outStr = `${outStr}${curStr
				.split("-")
				.map((e) => parseFloat(e) || 0)
				.reduce((a, b) => a + b, 0)
				.toFixed(0)}*${char}`;

			curStr = "";
		} else {
			curStr = curStr + char;
		}
	}

	if (curStr) {
		if (curStr.includes("-")) {
			outStr = `${outStr}${curStr
				.split("-")
				.map((e) => parseFloat(e) || 0)
				.reduce((a, b) => a + b, 0)}*`;
		} else {
			outStr = `${outStr}${curStr}`;
		}
	}

	// remove any trailing divisors
	return outStr.replace(/[|/-]$/u, "");
}

function calculateTotal(notesPerMeasure: Array<number>, npsPerMeasure: Array<number>): string {
	let total = 0;

	// these arrays are guaranteed to have same len
	for (const notes of notesPerMeasure) {
		if (notes >= MIN_NOTES_TO_BE_CONSIDERED_STREAM) {
			const streamMeasures = notes / MIN_NOTES_TO_BE_CONSIDERED_STREAM;

			total = total + streamMeasures;
		}
	}

	return total.toString();
}

function calculateDensity(notesPerMeasure: Array<number>) {
	let breaks = 0;
	let stream = 0;

	const firstStream = notesPerMeasure.findIndex((e) => e >= MIN_NOTES_TO_BE_CONSIDERED_STREAM);

	// really *really* inefficient
	const lastStream = notesPerMeasure
		.slice(0)
		.reverse()
		.findIndex((e) => e >= MIN_NOTES_TO_BE_CONSIDERED_STREAM);

	for (const notes of notesPerMeasure.slice(firstStream, notesPerMeasure.length - lastStream)) {
		if (notes >= MIN_NOTES_TO_BE_CONSIDERED_STREAM) {
			stream = stream + notes / MIN_NOTES_TO_BE_CONSIDERED_STREAM;
		} else if (stream > 0) {
			// breaks only count if we've saw stream before.
			breaks = breaks + 1;
		}
	}

	if (breaks === 0) {
		return 100;
	}

	return (100 * stream) / (stream + breaks);
}
