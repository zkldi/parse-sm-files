import crypto from "crypto";
import type { SMChart } from "./types";

type integer = number;

/**
 * Round a number to N decimal places.
 *
 * @example `RoundToNDP(1.594, 1) -> 1.6`
 * @example `RoundToNDP(1.591, 2) -> 1.69`
 *
 * @param number - The number to round.
 * @param dp - The amount of decimal places to round to.
 */
export function RoundToNDP(number: number, dp: integer) {
	const mul = 10 ** dp;

	return Math.round(number * mul) / mul;
}

// The groovestats hashing algorithm is uhh... difficult to implement. The specification
// (there is none) is the implementation, and the implementation is *all* regex string
// manipulation.
function NormaliseBPMs(bpms: SMChart["bpms"]) {
	return bpms.map((e) => `${e.beat.toFixed(3)}=${e.value.toFixed(3)}`).join(",");
}

function MinimizeMeasure(measureLines: Array<string>): Array<string> {
	let rows = measureLines.slice();

	// if rows.length is odd, it cannot be simplified any further.
	// wait.
	// that's not true
	// this check should be if rows.length is prime
	// however, the hash itg uses uses this check
	// sorry!
	while (rows.length % 2 === 0) {
		//    1000
		//    0000 <- OTHER
		//    0100
		//    0000 <- OTHER
		// becomes
		//    1000
		//    0100
		// if all *even* rows are 0000
		for (let i = 1; i < rows.length; i = i + 2) {
			const row = rows[i];

			// any non-zero chars in this string?
			if (/[^0]/u.exec(row)) {
				// can't be minimised
				return rows;
			}
		}

		// remove all even rows from this array
		rows = rows.filter((e, i) => i % 2 === 0);
	}

	return rows;
}

function MinimizeChart(chartStr: string) {
	const newData = [];

	for (const measure of chartStr.split(",")) {
		const min = MinimizeMeasure(measure.split(/[\r\n]+/u).filter((e) => e !== ""));

		newData.push(min.join("\n"));
	}

	return newData.join("\n,\n");
}

function sha1(string: string) {
	return crypto.createHash("sha1").update(string).digest("hex");
}

export default function hashSimfileFromString(
	bpms: SMChart["bpms"],
	notesStr: string,
	fileType: "sm" | "ssc"
) {
	const bpmStr = NormaliseBPMs(bpms);

	const minNotesStr = MinimizeChart(notesStr);

	if (fileType === "ssc") {
		throw new Error("SSC Unsupported.")
	}

	return sha1(minNotesStr + bpmStr).slice(0, 16);
}
