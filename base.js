const express = require("express");

const app = new express();

app.use(express.logger("dev"));
app.use(express.compression());

module.exports = app;
