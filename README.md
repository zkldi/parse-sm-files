# SM File Parser

This is an implementation for parsing SM in TypeScript.

It does things like Groovestats hashing, etc.

## Usage

`ts-node src/main.ts "SM/FILE/GLOB" <output location>`

## Output

An array of `SMResult`s.

```ts
export interface SMMetadata {
	title: string;
	artist: string;
	subtitle: string | null;
	titleTranslit: string | null;
	artistTranslit: string | null;
	subtitleTranslit: string | null;
}

export interface SMChart {
	// What BPM of streams does this chart predominantly have?
	streamBPM: number | null;

	// Who made this chart?
	credit: string | null;

	// What level did the charter think this chart was rated as?
	level: string;

	bpms: Array<{ beat: number; value: number }>;
	stops: Array<{ beat: number; value: number }>;

	notesPerMeasure: Array<number>;
	npsPerMeasure: Array<number>;

	// sha1(string concatenation of bpms and notes)
	hashGSv3: string;

	// Beginner, Hard, etc.
	difficultyTag: string;

	// Chart length in seconds.
	length: number;

	// Stream Breakdowns for this chart. Null if the chart has no streams.
	breakdown: {
		detailed: string;
		partiallySimplified: string;
		simplified: string;
		total: string;
		density: number;
	} | null;
}

export interface SMResults {
	meta: SMMetadata;
	charts: Array<SMChart>;
}
```