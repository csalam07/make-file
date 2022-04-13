#!/usr/bin/env node

const program  = require("../lib/index"),
	fs = require("fs");


program
	.version("0.0.1")
	.usage("[filename]")
	.parse(process.argv);

const filename = program.args.shift();

if (filename) {
	console.log("Created " + filename);
	const fd = fs.openSync(filename, "a"),
		now = new Date();
	fs.futimesSync(fd, now, now);
	fs.closeSync(fd);
}