// Tests for the connection string ⇄ JSON converter. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  connectionStringToJson,
  jsonToConnectionString,
  parseConnectionString,
  unwrapLiteral,
  wrapLiteral,
} from "./connection-string.ts";

// ---------------------------------------------------------------------------
// Code-literal quoting: strings are pasted as they appear in C# / appsettings.
// ---------------------------------------------------------------------------

test("unwrap: an unquoted string is used as-is", () => {
  assert.deepEqual(unwrapLiteral("  a=1;b=2  "), { ok: true, style: "none", text: "a=1;b=2" });
});

test("unwrap: a C#/JSON string drops its quotes and decodes escapes", () => {
  // As pasted:  "account=x;password=\"p;w\";path=C:\\tmp"
  const pasted = String.raw`"account=x;password=\"p;w\";path=C:\\tmp"`;
  assert.deepEqual(unwrapLiteral(pasted), {
    ok: true,
    style: "csharp",
    text: 'account=x;password="p;w";path=C:\\tmp',
  });
});

test("unwrap: a C# verbatim string turns doubled quotes into one", () => {
  // As pasted:  @"password=""p;w"";path=C:\tmp"
  const pasted = String.raw`@"password=""p;w"";path=C:\tmp"`;
  assert.deepEqual(unwrapLiteral(pasted), {
    ok: true,
    style: "verbatim",
    text: 'password="p;w";path=C:\\tmp',
  });
});

test("unwrap: the ; or , after a pasted code literal is ignored", () => {
  assert.equal(unwrapLiteral('"a=1;b=2";').text, "a=1;b=2");
  assert.equal(unwrapLiteral('"a=1;b=2",').text, "a=1;b=2");
});

test("unwrap: a trailing ; on an unquoted string is kept (it is part of it)", () => {
  assert.equal(unwrapLiteral("a=1;b=2;").text, "a=1;b=2;");
});

test("unwrap: \\u escapes are decoded", () => {
  assert.equal(unwrapLiteral(String.raw`"user=Jos\u00e9"`).text, "user=José");
});

test("unwrap: an unknown escape is reported", () => {
  const r = unwrapLiteral(String.raw`"a=\q"`);
  assert.equal(r.ok, false);
  assert.match(r.error, /\\q/);
});

test("unwrap: two concatenated literals are reported, not merged", () => {
  const r = unwrapLiteral('"a=1;" + "b=2"');
  assert.equal(r.ok, false);
});

test("wrap: C#/JSON style escapes quotes and backslashes", () => {
  assert.equal(
    wrapLiteral('password="p;w";path=C:\\tmp', "csharp"),
    String.raw`"password=\"p;w\";path=C:\\tmp"`,
  );
});

test("wrap: verbatim style doubles quotes and leaves backslashes", () => {
  assert.equal(
    wrapLiteral('password="p;w";path=C:\\tmp', "verbatim"),
    String.raw`@"password=""p;w"";path=C:\tmp"`,
  );
});

test("wrap: no-quotes style returns the text unchanged", () => {
  assert.equal(wrapLiteral('a="x"', "none"), 'a="x"');
});

// ---------------------------------------------------------------------------
// Parsing key=value pairs (.NET DbConnectionStringBuilder rules).
// ---------------------------------------------------------------------------

const settingsOf = (text) => {
  const r = parseConnectionString(text);
  assert.equal(r.ok, true, r.error);
  return r.settings;
};

test("parse: a Snowflake string becomes its settings, in order", () => {
  assert.deepEqual(
    settingsOf("account=xy12345.us-east-1;user=jdoe;db=ANALYTICS;warehouse=COMPUTE_WH;role=ANALYST"),
    [
      { key: "account", value: "xy12345.us-east-1" },
      { key: "user", value: "jdoe" },
      { key: "db", value: "ANALYTICS" },
      { key: "warehouse", value: "COMPUTE_WH" },
      { key: "role", value: "ANALYST" },
    ],
  );
});

test("parse: spaces around keys and plain values are trimmed; spaces inside keys stay", () => {
  assert.deepEqual(settingsOf(" Data Source = my server ; User Id=sa "), [
    { key: "Data Source", value: "my server" },
    { key: "User Id", value: "sa" },
  ]);
});

test('parse: a "…" value keeps ; = and spaces, and "" means one quote', () => {
  assert.deepEqual(settingsOf('password=" p;w=""x"" ";user=a'), [
    { key: "password", value: ' p;w="x" ' },
    { key: "user", value: "a" },
  ]);
});

test("parse: a '…' value works the same way with ''", () => {
  assert.deepEqual(settingsOf("password='it''s;ok'"), [{ key: "password", value: "it's;ok" }]);
});

test("parse: == in a key is a literal =", () => {
  assert.deepEqual(settingsOf("a==b=c"), [{ key: "a=b", value: "c" }]);
});

test("parse: = inside a plain value is part of the value", () => {
  assert.deepEqual(settingsOf("AccountKey=abc+def=="), [{ key: "AccountKey", value: "abc+def==" }]);
});

test("parse: an empty value is allowed", () => {
  assert.deepEqual(settingsOf("a=;b=2"), [
    { key: "a", value: "" },
    { key: "b", value: "2" },
  ]);
});

test("parse: empty segments and a trailing ; are ignored", () => {
  assert.deepEqual(settingsOf(";a=1;;b=2;"), [
    { key: "a", value: "1" },
    { key: "b", value: "2" },
  ]);
});

test("parse: an unclosed quote is reported at the quote, naming the setting", () => {
  const r = parseConnectionString('a=1;password="x;y');
  assert.equal(r.ok, false);
  assert.equal(r.position, 13);
  assert.match(r.error, /password/);
});

test("parse: a setting without = is reported", () => {
  const r = parseConnectionString("a=1;oops;b=2");
  assert.equal(r.ok, false);
  assert.match(r.error, /oops/);
});

test("parse: text after a closing quote is reported", () => {
  const r = parseConnectionString('a="x"y;b=1');
  assert.equal(r.ok, false);
  assert.equal(r.position, 5);
});

test("parse: a value without a name is reported", () => {
  assert.equal(parseConnectionString("a=1;=x").ok, false);
});

// ---------------------------------------------------------------------------
// Connection string → JSON
// ---------------------------------------------------------------------------

const SNOWFLAKE = String.raw`"account=xy12345.us-east-1;user=jdoe;password=\"p;w\";db=ANALYTICS;role=ANALYST"`;

test("to JSON: a pasted Snowflake C# string becomes one key per setting", () => {
  const r = connectionStringToJson(SNOWFLAKE);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.style, "csharp");
  assert.equal(
    r.json,
    [
      "{",
      '  "account": "xy12345.us-east-1",',
      '  "user": "jdoe",',
      '  "password": "p;w",',
      '  "db": "ANALYTICS",',
      '  "role": "ANALYST"',
      "}",
    ].join("\n"),
  );
  assert.deepEqual(r.warnings, []);
});

test("to JSON: order is kept even for number-like keys", () => {
  const r = connectionStringToJson("b=1;10=x;a=2");
  assert.equal(r.json, '{\n  "b": "1",\n  "10": "x",\n  "a": "2"\n}');
});

test("to JSON: values stay text", () => {
  const r = connectionStringToJson("port=443;ssl=true");
  assert.equal(r.json, '{\n  "port": "443",\n  "ssl": "true"\n}');
});

test("to JSON: a repeated setting keeps the last value (as .NET does) and warns", () => {
  const r = connectionStringToJson("user=a;db=x;user=b");
  assert.equal(r.json, '{\n  "db": "x",\n  "user": "b"\n}');
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /user/);
});

test("to JSON: an empty string gives an empty object", () => {
  assert.equal(connectionStringToJson("   ").json, "{}");
});

test("to JSON: a parse error comes back with its position", () => {
  const r = connectionStringToJson('a=1;password="x;y');
  assert.equal(r.ok, false);
  assert.equal(r.position, 13);
});

test("to JSON: a quoting error comes back as an error", () => {
  assert.equal(connectionStringToJson(String.raw`"a=\q"`).ok, false);
});

// ---------------------------------------------------------------------------
// JSON → connection string
// ---------------------------------------------------------------------------

/** Convert to JSON, apply `edit` to the parsed object, convert back. */
function roundTrip(pasted, edit = (o) => o) {
  const to = connectionStringToJson(pasted);
  assert.equal(to.ok, true, to.error);
  const json = JSON.stringify(edit(JSON.parse(to.json)), null, 2);
  return jsonToConnectionString(json, to.style, to.source);
}

const SQL = String.raw`"Data Source=srv; User Id = sa; Password=\"p;w\"; Encrypt=True;"`;

test("back: with no edits the original string comes back exactly", () => {
  assert.deepEqual(roundTrip(SQL), { ok: true, text: SQL });
  assert.deepEqual(roundTrip(SNOWFLAKE), { ok: true, text: SNOWFLAKE });
});

test("back: editing one value changes only that setting", () => {
  const r = roundTrip(SQL, (o) => ({ ...o, Encrypt: "False" }));
  assert.equal(r.text, String.raw`"Data Source=srv; User Id = sa; Password=\"p;w\"; Encrypt=False;"`);
});

test("back: added settings go at the end and removed ones disappear", () => {
  const r = roundTrip(SQL, ({ Encrypt, ...o }) => ({ ...o, Timeout: "30" }));
  assert.equal(r.text, String.raw`"Data Source=srv; User Id = sa; Password=\"p;w\"; Timeout=30;"`);
});

test("back: values are quoted only when they need it", () => {
  const json = JSON.stringify({
    plain: "abc==",
    semi: "a;b",
    dq: 'say "hi"',
    both: `it's "x";`,
    padded: " x ",
  });
  assert.deepEqual(jsonToConnectionString(json, "none"), {
    ok: true,
    text: `plain=abc==;semi="a;b";dq='say "hi"';both="it's ""x"";";padded=" x "`,
  });
});

test("back: = in a setting name is written as ==", () => {
  assert.equal(jsonToConnectionString('{"a=b": "c"}', "none").text, "a==b=c");
});

test("back: numbers, true/false and null are written as text", () => {
  assert.equal(
    jsonToConnectionString('{"port": 443, "ssl": true, "role": null}', "none").text,
    "port=443;ssl=true;role=",
  );
});

test("back: the chosen quote style is applied", () => {
  assert.equal(jsonToConnectionString('{"password": "p;w"}', "verbatim").text, '@"password=""p;w"""');
  assert.equal(jsonToConnectionString('{"password": "p;w"}', "csharp").text, String.raw`"password=\"p;w\""`);
});

test("back: a nested object or list is an error naming the setting", () => {
  const obj = jsonToConnectionString('{"a": "1", "opts": {"x": 1}}', "none");
  assert.equal(obj.ok, false);
  assert.match(obj.error, /opts/);
  const list = jsonToConnectionString('{"hosts": ["a", "b"]}', "none");
  assert.equal(list.ok, false);
  assert.match(list.error, /hosts/);
});

test("back: JSON that isn't an object is an error", () => {
  assert.equal(jsonToConnectionString('["a=1"]', "none").ok, false);
  assert.equal(jsonToConnectionString('"a=1"', "none").ok, false);
  assert.equal(jsonToConnectionString("null", "none").ok, false);
});

test("back: invalid JSON is an error", () => {
  assert.equal(jsonToConnectionString('{"a": "1",}', "none").ok, false);
});
