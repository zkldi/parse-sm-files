import { SMParser } from "./parser";
import glob from "glob";
import { CreateLogger } from "mei-logger";
import { writeFileSync } from "fs";
import { readFile } from "fs/promises";
import type { SMResults } from "./types";

const logger = CreateLogger("SM Hash Dir", undefined);

const dir = process.argv[2];

const outFile = process.argv[3];

if (!dir) {
	logger.error(`Expected directory to search for .sm files in.`);
	process.exit(1);
}

if (!outFile) {
	logger.error(`Expected second argument for where to store the output.`);
	process.exit(1);
}

async function main() {
	const output: Array<SMResults> = [];

	const files = glob.sync(`${dir}/**/*.sm`);

	let failed = 0;

	await Promise.all(
		files.map(async (file) => {
			const content = await readFile(file, "utf-8");

			const parser = new SMParser(file);

			try {
				const data = parser.parseSM(content);

				output.push(data);
			} catch (err) {
				failed++;
			}
		})
	);

	logger.info(`${files.length} parsed. ${failed} failed.`);

	writeFileSync(outFile, JSON.stringify(output), "utf-8");
}

if (require.main === module) {
	void main();
}
