#!/usr/bin/env node
"use strict";

var engines = require("../package.json").engines.node;
var required = Number(/\d+/.exec(engines)[0]);
var current = process.versions.node;

if (Number(current.split(".")[0]) < required) {
  console.error(
    "outil needs Node.js " + required + " or newer, but this is Node.js " + current + ".\n" +
      "Install a newer version from https://nodejs.org and run the command again."
  );
  process.exit(1);
}

var cli = require("url").pathToFileURL(require("path").join(__dirname, "../dist/server/cli.js")).href;

new Function("url", "return import(url)")(cli).catch(function (err) {
  console.error(err);
  process.exit(1);
});
