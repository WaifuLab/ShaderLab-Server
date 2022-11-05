const debug = require("debug")("shaderlab:server");
const { colors } = require("../utils/style");

const rawSqlKeyWords = ["ADD", "ADD CONSTRAINT", "ALTER", "ALTER COLUMN", "ALTER TABLE", "ALL", "AND", "ANY", "AS",
    "ASC", "BACKUP DATABASE", "BETWEEN", "CASE", "CHECK", "COLUMN", "CONSTRAINT", "CREATE", "CREATE DATABASE",
    "CREATE INDEX", "CREATE OR REPLACE VIEW", "CREATE TABLE", "CREATE PROCEDURE", "CREATE UNIQUE INDEX", "CREATE VIEW",
    "DATABASE", "DEFAULT", "DELETE", "DESC", "DISTINCT", "DROP", "DROP COLUMN", "DROP CONSTRAINT", "DROP DATABASE",
    "DROP DEFAULT", "DROP INDEX", "DROP TABLE", "DROP VIEW", "EXEC", "EXISTS", "FOREIGN KEY", "FROM", "FULL OUTER JOIN",
    "GROUP BY", "HAVING", "IN", "INDEX", "INNER JOIN", "INSERT INTO", "INSERT INTO SELECT", "IS NULL", "IS NOT NULL",
    "JOIN", "LEFT JOIN", "LIKE", "LIMIT", "NOT", "NOT NULL", "OR", "ORDER BY", "OUTER JOIN", "PRIMARY KEY", "PROCEDURE",
    "RIGHT JOIN", "ROWNUM", "SELECT", "SELECT DISTINCT", "SELECT INTO", "SELECT TOP", "SET", "TABLE", "TOP",
    "TRUNCATE TABLE", "UNION", "UNION ALL", "UNIQUE", "UPDATE", "VALUES", "VIEW", "WHERE", "PRAGMA", "INTEGER",
    "PRIMARY", "letCHAR", "DATETIME", "NULL", "REFERENCES", "INDEX_LIST", "BY", "CURRENT_DATE", "CURRENT_TIME", "EACH",
    "ELSE", "ELSEIF", "FALSE", "FOR", "GROUP", "IF", "INSERT", "INTERVAL", "INTO", "IS", "KEY", "KEYS", "LEFT", "MATCH",
    "ON", "OPTION", "ORDER", "OUT", "OUTER", "REPLACE", "TINYINT", "RIGHT", "THEN", "TO", "TRUE", "WHEN", "WITH",
    "UNSIGNED", "CASCADE", "ENGINE", "TEXT", "AUTO_INCREMENT", "SHOW", "BEGIN", "END", "PRINT", "OVERLAPS"];

const sql = module.exports = {
    // when debug sql query, enable lower case highlighting
    requiredLowercase: false,
    rules: [
        {
            name: "keyword",
            group: 1,
            regex: new RegExp(`(^|[^a-zA-Z_])(${[...rawSqlKeyWords, ...rawSqlKeyWords.map(keyword => keyword.toLowerCase())].join('|')})(?=[^a-zA-Z_]|$)`, "g"),
            style: code => colors.magenta(code, "[0m")
        }, {
            name: "special",
            regex: /(=|!=|%|\/|\*|-|,|;|:|\+|<|>)/g,
            style: code => colors.yellow(code, "[0m")
        }, {
            name: "function",
            regex: /(\w+?)\(/g,
            trimEnd: 1,
            style: code => colors.red(code, "[0m")
        }, {
            name: "number",
            regex: /((?<![a-zA-z])\d+(?:\.\d+)?)/g,
            style: code => colors.green(code, "[0m")
        }, {
            name: "string",
            regex: /(["'`].*?["'`])/g,
            style: code => colors.green(code, "[0m")
        }, {
            name: "bracket",
            regex: /([()])/g,
            style: code => colors.yellow(code, "[0m")
        }
    ],
    // database details
    host: process.env.MYSQL_HOST || "localhost",
    port: process.env.MYSQL_PORT || 3306,
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD ||  "" ,
    database: process.env.MYSQL_DATABASE || "shaderlab",
    dialect: "mysql",
    pool: {
        max: 5,
        min: 0,
        acquire: 30000, // maximum time, in milliseconds, that pool will try to get connection before throwing error
        idle: 10000 // maximum time, in milliseconds, that a connection can be idle before being released
    }
}
