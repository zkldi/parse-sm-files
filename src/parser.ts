/* eslint-disable operator-assignment */
import { CreateBreakdowns } from "./breakdown";
import hashSimfileFromString from "./hashSimfile";
import { CreateLogger } from "mei-logger";
import type { SMChart, SMMetadata, SMResults as SMParsed } from "./types";
import type { MeiLogger } from "mei-logger";

function readElement(element: string, delimiter: string) {
	// we actually quite literally want to split on the first char
	// and only the first char here.
	const [key, ...value] = element.split(delimiter);

	// so stuff like
	// #TITLE:apo::lith
	// is parsed correctly.
	// horrendously inefficient
	// i don't care.
	const rejoinedValue = value.join(delimiter);

	// strip trailing/leading whitespace out of any values or keys
	return { key: key.trim(), value: rejoinedValue.trim() };
}

export class SMParser {
	logger: MeiLogger;

	constructor(filename: string) {
		this.logger = CreateLogger(filename);
	}

	parseSM(smContent: string): SMParsed {
		const charts: Array<SMChart> = [];

		const partialMeta: Partial<SMMetadata> = {};

		const bpms: SMChart["bpms"] = [];
		const stops: SMChart["stops"] = [];

		// remove comments (lol)
		// this is how sm does it.
		// don't mind me

		let newSMContent = "";

		for (const line of smContent.split(/[\r\n]+/u)) {
			const data = line.split("//");

			newSMContent = `${newSMContent}${data[0]}\n`;
		}

		for (const element of newSMContent.split(";")) {
			const { key, value } = readElement(element, ":");

			// skip empty entries
			if (value.trim() === "") {
				continue;
			}

			switch (key) {
				case "#TITLE": {
					partialMeta.title = value;
					break;
				}

				case "#ARTIST": {
					partialMeta.artist = value;
					break;
				}

				case "#SUBTITLE": {
					// empty str -> null
					partialMeta.subtitle = value || null;
					break;
				}

				case "#TITLETRANSLIT": {
					partialMeta.titleTranslit = value || null;
					break;
				}

				case "#ARTISTTRANSLIT": {
					partialMeta.artistTranslit = value || null;
					break;
				}

				case "#SUBTITLETRANSLIT": {
					partialMeta.subtitleTranslit = value || null;
					break;
				}

				case "#BPMS": {
					const bpmElements = value.split(",").map((e) => e.trim());

					for (const bpmElement of bpmElements) {
						const { key: measure, value: bpmValue } = readElement(bpmElement, "=");

						bpms.push({ beat: Number(measure), value: Number(bpmValue) });
					}

					break;
				}

				case "#STOPS": {
					const stopElements = value.split(",").map((e) => e.trim());

					for (const stopElement of stopElements) {
						const { key: measure, value: stopValue } = readElement(stopElement, "=");

						stops.push({ beat: Number(measure), value: Number(stopValue) });
					}

					break;
				}

				case "#NOTES": {
					const chart = this.#parseNotesSM(value, bpms, stops);

					if (chart === null) {
						// nothing to see here, non-dance-single or not parsable for
						// some other reason
						continue;
					}

					charts.push(chart);
					break;
				}
			}
		}

		if (!partialMeta.artist) {
			this.logger.error(`No #ARTIST defined in SM?`);
			throw new Error(`No #ARTIST defined in SM?`);
		}

		if (!partialMeta.title) {
			this.logger.error(`No #TITLE defined in SM?`);
			throw new Error(`No #TITLE defined in SM?`);
		}

		const meta: SMMetadata = {
			artist: partialMeta.artist,
			title: partialMeta.title,
			subtitle: partialMeta.subtitle ?? null,
			artistTranslit: partialMeta.artistTranslit ?? null,
			subtitleTranslit: partialMeta.subtitleTranslit ?? null,
			titleTranslit: partialMeta.titleTranslit ?? null,
		};

		this.logger.verbose(
			`Parsed ${meta.artist} - ${meta.title} with ${charts.length} chart(s).`
		);

		return {
			meta,
			charts,
		};
	}

	#parseNotesSM(
		notesStr: string,
		bpms: SMChart["bpms"],
		stops: SMChart["stops"]
	): SMChart | null {
		// first 5 entries are hard-coded and colon postfixed.

		// only trimStart. don't remove trailing newlines as they're significant
		// to notes.
		// this parser sucks. barely qualifies as a parser.
		const entries = notesStr.split(":").map((e) => e.trimStart());

		if (entries.length !== 6) {
			this.logger.error(
				`Invalid SM #NOTES. Got ${
					entries.length
				} entries, but expected 6. Cannot parse chart. ${entries.join(":")}`
			);
			throw new Error(`Invalid SM #NOTES`);
		}

		const [playtype, credit, difficultyTag, level, _grooveNonsense, notes] = entries;

		if (playtype !== "dance-single") {
			this.logger.verbose(`Skipping ${playtype} chart.`);
			return null;
		}

		const notesPerMeasure = this.#countNotesPerMeasure(notes);

		const hashGSv3 = hashSimfileFromString(bpms, notes, "sm");

		const streamBPM = this.getTierBPM(bpms, notesPerMeasure);

		return {
			bpms,
			credit,
			streamBPM,
			level,
			notesPerMeasure,
			stops,
			hashGSv3,
			difficultyTag,
			breakdown: CreateBreakdowns(notesPerMeasure, []),
			length: this.#calculateLength(bpms, notesPerMeasure.length),
			npsPerMeasure: this.#calculateNPSPerMeasure(notesPerMeasure, bpms),
		};
	}

	MIN_NOTES_TO_BE_CONSIDERED_STREAM = 16;
	getTierBPM(bpms: SMChart["bpms"], notesPerMeasure: Array<number>): number | null {
		// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
		if (!bpms[0]) {
			return null;
		}

		const firstBPM = bpms[0].value;

		for (const bpm of bpms) {
			// if this bpm is more than 1bpm deviant from the first bpm
			if (bpm.value - firstBPM > 1) {
				// we can't auto-infer the primary bpm for this chart
				return null;
			}
		}

		// ok, got the "main" BPM. now multiply by the most frequent stream type.

		// how many streams are there for each note type?
		const noteFreqDist: Record<number, number> = {};
		let totalStream = 0;

		for (const notes of notesPerMeasure) {
			if (notes < this.MIN_NOTES_TO_BE_CONSIDERED_STREAM) {
				continue;
			}

			const measuresOfStream = notes / this.MIN_NOTES_TO_BE_CONSIDERED_STREAM;

			if (noteFreqDist[notes]) {
				noteFreqDist[notes] += measuresOfStream;
			} else {
				noteFreqDist[notes] = measuresOfStream;
			}

			totalStream += measuresOfStream;
		}

		// the bpm tier is the largest value that takes up atleast 5% of the
		// stream in the chart. rough ballpark.
		for (const key of Object.keys(noteFreqDist).sort((a, b) => Number(b) - Number(a))) {
			const SPEED = Number(key) / 16;

			if (noteFreqDist[Number(key)] >= totalStream * 0.05) {
				return firstBPM * SPEED;
			}
		}

		// otherwise just assume 16ths lol
		return firstBPM;
	}

	#calculateLength(bpms: SMChart["bpms"], finalMeasure: number): number {
		let length = 0;

		for (let i = 0; i < bpms.length; i++) {
			const bpm = bpms[i]!;

			// might not exist
			const nextBPM = bpms[i + 1] as SMChart["bpms"][0] | undefined;

			let beats;

			if (nextBPM) {
				beats = nextBPM.beat - bpm.beat;
			} else {
				beats = finalMeasure * 4 - bpm.beat;
			}

			const secondsPerBeat = 60 / bpm.value;

			length = length + beats * secondsPerBeat;
		}

		return length;
	}

	// @warn
	// this doesn't work for mid-measure bpm changes
	// i don't care though
	#calculateNPSPerMeasure(notesPerMeasure: Array<number>, bpms: SMChart["bpms"]): Array<number> {
		function getThisMeasuresBPM(beat: number): number {
			// iterate bpms in reverse
			for (const bpm of bpms.slice().sort((a, b) => b.beat - a.beat)) {
				if (beat >= bpm.beat) {
					return bpm.value;
				}
			}

			// first bpm ig
			return bpms[0].value;
		}

		return notesPerMeasure.map((notes, i) => {
			const bpm = getThisMeasuresBPM(i / 4);

			return notes * (bpm / 240);
		});
	}

	#countNotesPerMeasure(notes: string): SMChart["notesPerMeasure"] {
		const notesPerMeasure = [];

		const measures = notes.split(",");

		for (const measure of measures) {
			let notes = 0;

			for (const line of measure.split(/[\n]+/u)) {
				// if there's any note (1),
				// hold start (3)
				// or roll start (4)
				// in this line
				if (/[124]/u.exec(line)) {
					notes++;
				}
			}

			notesPerMeasure.push(notes);
		}

		return notesPerMeasure;
	}
}
