"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { Copy, CornerDownLeft, Plug } from "lucide-react";
import JsonEditor from "../JsonEditor";
import { Button, Select, useToast } from "../ui";
import { copyText } from "@/lib/clipboard";
import { motionTokens } from "@/lib/motion-tokens";
import {
  connectionStringToJson,
  jsonToConnectionString,
  type QuoteStyle,
  type Source,
} from "@/lib/json/connection-string";
import { type ToolProps } from "./types";

interface State {
  /** The connection string as shown in the bar, code quotes included. */
  text: string;
  json: string;
  style: QuoteStyle;
  /** The last string read from the bar; unchanged settings keep its text. */
  source?: Source;
  count: number;
  warnings: string[];
  /** The bar's string can't be read, so the JSON wasn't updated. */
  stringError: string | null;
  /** The JSON can't be converted, so the bar wasn't updated. */
  jsonError: string | null;
  /** A string has been converted: the bar sits on top with the JSON below. */
  converted: boolean;
  /** Convert was tried (Enter, button or paste), so show why it can't be yet. */
  attempted: boolean;
}

const EMPTY: State = {
  text: "",
  json: "",
  style: "csharp",
  count: 0,
  warnings: [],
  stringError: null,
  jsonError: null,
  converted: false,
  attempted: false,
};

// Kept in memory only: survives switching tools, gone on reload, so pasted
// passwords are never written to storage.
let remembered: State = EMPTY;

const STYLE_OPTIONS = [
  { value: "csharp", label: 'Quotes: C# / JSON "…"' },
  { value: "verbatim", label: 'Quotes: C# verbatim @"…"' },
  { value: "none", label: "Quotes: none" },
];

const MOVE = { duration: motionTokens.duration.normal, ease: motionTokens.easing.smooth };
const FADE = { duration: motionTokens.duration.fast, ease: motionTokens.easing.smooth };

function countSettings(json: string): number {
  try {
    return Object.keys(JSON.parse(json) as object).length;
  } catch {
    return 0;
  }
}

const sentence = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);

/** Convert the bar's string into the JSON side. */
function fromString(prev: State, text: string): State {
  const r = connectionStringToJson(text);
  if (!r.ok) return { ...prev, text, stringError: r.error };
  const empty = text.trim() === "";
  return {
    ...prev,
    text,
    json: empty ? "" : r.json,
    style: empty ? prev.style : r.style,
    source: r.source,
    count: r.source.settings.length,
    warnings: r.warnings,
    stringError: null,
    jsonError: null,
  };
}

/** Convert the JSON side into the bar's string. */
function fromJson(prev: State, json: string, style = prev.style): State {
  if (json.trim() === "") {
    return { ...prev, json, style, text: "", count: 0, warnings: [], stringError: null, jsonError: null };
  }
  const r = jsonToConnectionString(json, style, prev.source);
  if (!r.ok) return { ...prev, json, style, jsonError: r.error };
  return {
    ...prev,
    json,
    style,
    text: r.text,
    count: countSettings(json),
    warnings: [],
    stringError: null,
    jsonError: null,
  };
}

/** Move the bar up once the string reads cleanly; otherwise show why not. */
function tryConvert(s: State): State {
  const ready = s.stringError === null && s.count > 0;
  return ready ? { ...s, converted: true, attempted: false } : { ...s, attempted: true };
}

/**
 * Connection string ⇄ JSON. The input starts centered; once a string is
 * converted (pasted, Enter, or Convert) it moves up into a bar with the JSON
 * below, and edits on either side update the other.
 */
export default function ConnStringTool(_props: ToolProps) {
  const [state, setState] = useState<State>(remembered);
  const toast = useToast();
  const barRef = useRef<HTMLTextAreaElement>(null);
  const pasted = useRef(false);
  const centered = !state.converted;

  useEffect(() => {
    remembered = state;
  }, [state]);

  // Grow the bar with its content (up to a cap, then it scrolls).
  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [state.text, centered]);

  const onJsonChange = useCallback(
    (json: string) => setState((s) => fromJson(s, json)),
    [],
  );

  const copy = async () => {
    const ok = await copyText(state.text);
    toast(ok ? "Connection string copied" : "Copy failed", { kind: ok ? "ok" : "error" });
  };

  // Top bar: errors from either side. Centered: only after trying to convert.
  const error = state.stringError ?? state.jsonError;
  const errorText = state.stringError
    ? `Can't read this string: ${sentence(state.stringError)} The JSON below wasn't updated.`
    : state.jsonError
      ? `Not updated — ${sentence(state.jsonError)} Showing the last good string.`
      : null;
  const centeredError = !state.attempted
    ? null
    : state.stringError
      ? `Can't read this string: ${sentence(state.stringError)}`
      : state.count === 0
        ? "No settings found. Expected key=value pairs separated by ;"
        : null;

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative flex h-full min-h-0 flex-col">
        <div
          // z-10: the bar stays above the JSON pane while it slides up.
          className={
            centered
              ? "relative z-10 flex flex-1 flex-col items-center justify-center gap-3 p-4"
              : "relative z-10 border-b border-border p-2"
          }
        >
          <AnimatePresence mode="popLayout">
            {centered && (
              <motion.div
                key="intro"
                className="flex w-full max-w-2xl flex-col items-center gap-1 text-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={FADE}
              >
                <span className="flex items-center gap-2 text-sm font-medium text-gray-200">
                  <Plug size={16} aria-hidden="true" />
                  Connection string → JSON
                </span>
                <span className="text-xs text-gray-500">
                  Snowflake, SQL Server, Postgres and other .NET strings. Paste it as it
                  appears in your code, quotes and all.
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* The same bar in both places, so it keeps focus as it moves up. */}
          <motion.div
            layout
            transition={MOVE}
            className={`w-full overflow-hidden rounded-lg border bg-bg-soft ${
              centered ? "max-w-2xl shadow-lg" : ""
            } ${(centered ? centeredError : error) ? "border-danger-border" : "border-border"}`}
          >
            <motion.textarea
              layout="position"
              transition={MOVE}
              ref={barRef}
              value={state.text}
              autoFocus={centered}
              onPaste={() => {
                pasted.current = true;
              }}
              onChange={(e) => {
                const text = e.target.value;
                const wasPaste = pasted.current;
                pasted.current = false;
                setState((s) => {
                  const next = fromString(s, text);
                  return wasPaste && !next.converted ? tryConvert(next) : next;
                });
              }}
              onKeyDown={(e) => {
                if (centered && e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  setState(tryConvert);
                }
              }}
              rows={1}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              aria-label="Connection string"
              aria-invalid={Boolean(centered ? centeredError : error)}
              placeholder="Paste a connection string as it appears in your code, quotes and all"
              className={`block w-full resize-none break-all bg-transparent font-mono leading-relaxed text-gray-200 placeholder:text-gray-500 focus:outline-none ${
                centered ? "px-4 py-3 text-sm" : "px-3 py-2 text-[13px]"
              }`}
            />
            <motion.div
              layout="position"
              transition={MOVE}
              className="flex flex-wrap items-center gap-2 border-t border-border px-2 py-1.5"
            >
              {centered ? (
                <>
                  <span className="flex items-center gap-1 px-1 text-xs text-gray-500">
                    <CornerDownLeft size={12} aria-hidden="true" />
                    Enter to convert
                  </span>
                  <Button
                    variant="primary"
                    className="ml-auto"
                    onClick={() => setState(tryConvert)}
                    disabled={state.text.trim() === ""}
                  >
                    Convert
                  </Button>
                </>
              ) : (
                <>
                  <Select
                    title="How the string is quoted in your code. Copy uses this style."
                    value={state.style}
                    options={STYLE_OPTIONS}
                    onChange={(v) => setState((s) => fromJson(s, s.json, v as QuoteStyle))}
                    className="!py-1 text-xs"
                  />
                  {!error && state.count > 0 && (
                    <span className="text-xs text-gray-500">
                      {state.count} setting{state.count === 1 ? "" : "s"}
                    </span>
                  )}
                  {errorText && (
                    <span role="alert" className="text-xs text-danger">
                      {errorText}
                    </span>
                  )}
                  {!error &&
                    state.warnings.map((w) => (
                      <span key={w} className="text-xs text-warning">
                        {w}
                      </span>
                    ))}
                  <div className="ml-auto flex items-center gap-1.5">
                    <Button onClick={() => setState(EMPTY)}>Clear</Button>
                    <Button
                      variant="primary"
                      onClick={copy}
                      disabled={!state.text || state.jsonError !== null}
                      title="Copy the connection string, in the quote style above"
                    >
                      <Copy size={14} />
                      Copy
                    </Button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>

          <AnimatePresence mode="popLayout">
            {centered && centeredError && (
              <motion.p
                key="error"
                role="alert"
                className="w-full max-w-2xl px-1 text-xs text-danger"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={FADE}
              >
                {centeredError}
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        <AnimatePresence mode="popLayout">
          {!centered && (
            <motion.div
              key="json"
              className="relative min-h-0 flex-1"
              initial={{ opacity: 0, y: motionTokens.distance.sm }}
              animate={{ opacity: 1, y: 0, transition: { ...MOVE, delay: motionTokens.duration.fast } }}
              exit={{ opacity: 0, transition: FADE }}
            >
              <JsonEditor value={state.json} onChange={onJsonChange} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
